/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { findTool, toAgentTool } from '../../src/agent/chat/registry.js';
import type { ToolCtx, ToolResult } from '../../src/agent/chat/types.js';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { setContinuityEnabledForTest } from '../../src/continuity/flag.js';
import { CONTINUITY_RECOMPUTE_JOB_TYPE } from '../../src/continuity/enqueue.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentChatPreviews, agentJobs, tasks } from '../../src/db/schema.js';
import { createTask, getTask, patchTask } from '../../src/tasks/tasks.service.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  setContinuityEnabledForTest(true);
});

afterEach(() => {
  setContinuityEnabledForTest(null);
});

afterAll(async () => {
  await app.close();
});

function shanghaiIso(local: string): string {
  const iso = DateTime.fromISO(local, { zone: TZ }).toISO();
  if (!iso) throw new Error(`invalid local ${local}`);
  return iso;
}

function sameTime(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

function ctxFor(userId: string, timezone: string): ToolCtx {
  return {
    userId,
    timezone,
    conversationId: randomUUID(),
    page: { section: 'today', listId: 'smart:today', visibleTaskIds: [], visibleTruncated: false },
    gate: { mutated: false, plan: null },
    domainMutated: { value: false },
  };
}

async function runTool(name: string, ctx: ToolCtx, params: unknown): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const executed = await toAgentTool(tool, ctx).execute('call', params as never);
  return executed.details as ToolResult;
}

async function previewArgs(id: string): Promise<{
  groups?: { id: string; taskIds: string[] }[];
  protectedBlocks?: { id: string; version: number; label: string }[];
}> {
  const [row] = await getDb().select().from(agentChatPreviews).where(eq(agentChatPreviews.id, id)).limit(1);
  return (row?.args ?? {}) as {
    groups?: { id: string; taskIds: string[] }[];
    protectedBlocks?: { id: string; version: number; label: string }[];
  };
}

describe('plan dependency groups', () => {
  it('skips B when grouped A cannot apply', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const taskA = await createTask(alice.id, {
      title: '腾位A',
      listId: list,
      timezone: TZ,
      isAllDay: false,
      startAt: shanghaiIso('2026-10-30T10:00:00'),
      dueAt: shanghaiIso('2026-10-30T11:00:00'),
    });
    const taskB = await createTask(alice.id, { title: '移入B', listId: list, timezone: TZ });
    const ctx = ctxFor(alice.id, entity.timezone);
    const preview = await runTool('tasks.propose_plan', ctx, {
      patches: [
        {
          taskId: taskA.id,
          startAt: shanghaiIso('2026-10-30T14:00:00'),
          dueAt: shanghaiIso('2026-10-30T15:00:00'),
        },
        {
          taskId: taskB.id,
          startAt: shanghaiIso('2026-10-30T10:00:00'),
          dueAt: shanghaiIso('2026-10-30T11:00:00'),
        },
      ],
    });
    if (preview.status !== 'preview') throw new Error(JSON.stringify(preview));
    const stored = await previewArgs(preview.previewId);
    expect(stored.groups).toHaveLength(1);
    expect(stored.groups![0]!.taskIds.sort()).toEqual([taskA.id, taskB.id].sort());

    await patchTask(alice.id, taskA.id, { title: '外部改过A' });
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${preview.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(0);
    const skipped = applied.json().skipped as { taskId: string; reason: string }[];
    expect(skipped.map((item) => item.taskId).sort()).toEqual([taskA.id, taskB.id].sort());

    const afterA = await getTask(alice.id, taskA.id);
    const afterB = await getTask(alice.id, taskB.id);
    expect(afterA.title).toBe('外部改过A');
    expect(afterA.startAt).toBe(taskA.startAt);
    expect(afterA.dueAt).toBe(taskA.dueAt);
    expect(afterB.startAt).toBeNull();
    expect(afterB.dueAt).toBeNull();
  });

  it('still skips an independent ungrouped patch', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const keep = await createTask(alice.id, { title: '留下', listId: list, timezone: TZ });
    const stale = await createTask(alice.id, { title: '会过期', listId: list, timezone: TZ });
    const timed = await createTask(alice.id, { title: '独立排时', listId: list, timezone: TZ });
    const ctx = ctxFor(alice.id, entity.timezone);
    const preview = await runTool('tasks.propose_plan', ctx, {
      patches: [
        { taskId: keep.id, title: '留下-已改' },
        { taskId: stale.id, title: '会过期-方案' },
        {
          taskId: timed.id,
          startAt: shanghaiIso('2026-10-30T16:00:00'),
          dueAt: shanghaiIso('2026-10-30T17:00:00'),
        },
      ],
    });
    if (preview.status !== 'preview') throw new Error(JSON.stringify(preview));
    const stored = await previewArgs(preview.previewId);
    expect(stored.groups ?? []).toEqual([]);

    await patchTask(alice.id, stale.id, { title: '外部标题' });
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${preview.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(2);
    const skipped = applied.json().skipped as { taskId: string; reason: string }[];
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.taskId).toBe(stale.id);
    expect(skipped[0]!.reason).toContain('改过');
    expect((await getTask(alice.id, keep.id)).title).toBe('留下-已改');
    expect((await getTask(alice.id, stale.id)).title).toBe('外部标题');
    const moved = await getTask(alice.id, timed.id);
    expect(sameTime(moved.startAt, shanghaiIso('2026-10-30T16:00:00'))).toBe(true);
    expect(sameTime(moved.dueAt, shanghaiIso('2026-10-30T17:00:00'))).toBe(true);
  });

  it('undo does not overwrite a task the user changed after apply', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const outcome = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/outcomes',
      token: alice.token,
      payload: { name: '跟进线程' },
    });
    expect(outcome.statusCode).toBe(200);
    const outcomeId = outcome.json().id as string;
    const activated = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/activate`,
      token: alice.token,
      payload: {},
    });
    expect(activated.statusCode).toBe(200);
    const keep = await createTask(alice.id, {
      title: '保持原题',
      listId: list,
      timezone: TZ,
      outcomeId,
    });
    const edited = await createTask(alice.id, {
      title: '会被用户改',
      listId: list,
      timezone: TZ,
      outcomeId,
    });
    const ctx = ctxFor(alice.id, entity.timezone);
    const preview = await runTool('tasks.propose_plan', ctx, {
      patches: [
        { taskId: keep.id, title: '方案后的保持' },
        { taskId: edited.id, title: '方案后的改名' },
      ],
    });
    if (preview.status !== 'preview') throw new Error(JSON.stringify(preview));
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${preview.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(2);
    const jobsAfterApply = await getDb()
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.jobType, CONTINUITY_RECOMPUTE_JOB_TYPE));
    expect(jobsAfterApply.length).toBeGreaterThan(0);

    await patchTask(alice.id, edited.id, { title: '用户后来改的' });
    const undo = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/undo',
      token: alice.token,
      payload: { hintId: applied.json().undoHintId },
    });
    expect(undo.statusCode).toBe(200);
    expect((await getTask(alice.id, keep.id)).title).toBe('保持原题');
    expect((await getTask(alice.id, edited.id)).title).toBe('用户后来改的');
  });

  it('skips a group that overlaps a protected block and mentions it in preview copy', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const block = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/continuity/protected-blocks',
      token: alice.token,
      payload: {
        kind: 'once',
        label: '家庭',
        startAt: shanghaiIso('2026-10-30T10:00:00'),
        endAt: shanghaiIso('2026-10-30T12:00:00'),
      },
    });
    expect(block.statusCode).toBe(200);
    const taskA = await createTask(alice.id, {
      title: '腾位A',
      listId: list,
      timezone: TZ,
      isAllDay: false,
      startAt: shanghaiIso('2026-10-30T10:00:00'),
      dueAt: shanghaiIso('2026-10-30T11:00:00'),
    });
    const taskB = await createTask(alice.id, { title: '移入B', listId: list, timezone: TZ });
    const ctx = ctxFor(alice.id, entity.timezone);
    const preview = await runTool('tasks.propose_plan', ctx, {
      patches: [
        {
          taskId: taskA.id,
          startAt: shanghaiIso('2026-10-30T14:00:00'),
          dueAt: shanghaiIso('2026-10-30T15:00:00'),
        },
        {
          taskId: taskB.id,
          startAt: shanghaiIso('2026-10-30T10:00:00'),
          dueAt: shanghaiIso('2026-10-30T11:00:00'),
        },
      ],
    });
    if (preview.status !== 'preview') throw new Error(JSON.stringify(preview));
    expect(preview.summary).toContain('家庭');
    const bDiff = preview.diffs?.find((diff) => diff.taskId === taskB.id);
    expect(bDiff?.changes.some((change) => change.label === '保护安排' && change.before.includes('家庭'))).toBe(
      true,
    );
    const stored = await previewArgs(preview.previewId);
    expect(stored.protectedBlocks?.some((item) => item.label === '家庭')).toBe(true);
    expect(stored.groups).toHaveLength(1);

    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${preview.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(0);
    const skipped = applied.json().skipped as { taskId: string; reason: string }[];
    expect(skipped.map((item) => item.taskId).sort()).toEqual([taskA.id, taskB.id].sort());
    expect(skipped.some((item) => item.reason.includes('家庭'))).toBe(true);

    const afterA = await getDb().select().from(tasks).where(eq(tasks.id, taskA.id)).limit(1);
    const afterB = await getTask(alice.id, taskB.id);
    expect(afterA[0]!.startAt?.toISOString()).toBe(new Date(taskA.startAt!).toISOString());
    expect(afterB.startAt).toBeNull();
  });
});
