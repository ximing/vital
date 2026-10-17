import { deviceCalendarWindow } from '@vital/dto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { buildFastify } from '../../src/app.js';
import { findTool, toAgentTool } from '../../src/agent/chat/registry.js';
import { answerScheduleRequest } from '../../src/agent/chat/tools/schedule.js';
import { SCHEDULE_OFF_TEXT } from '../../src/agent/schedule-proposal.js';
import { type ToolCtx, type ToolResult } from '../../src/agent/chat/types.js';
import { getDb } from '../../src/db/index.js';
import { tasks } from '../../src/db/schema.js';
import { createTask, getTask } from '../../src/tasks/tasks.service.js';
import { injectJson } from '../helpers/http.js';
import { present } from '../helpers/present.js';
import { inboxId, registerUser } from '../helpers/session.js';

const NOW = new Date('2026-10-15T01:00:00.000Z');
const ZONE = 'Asia/Shanghai';
const DAY = '2026-10-15';
const SPAN = deviceCalendarWindow(ZONE, NOW);
const START = '2026-10-15T01:00:00.000Z';
const END = '2026-10-15T09:30:00.000Z';
const SLOT_START = '2026-10-15T09:30:00.000Z';
const SLOT_END = '2026-10-15T10:00:00.000Z';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

afterAll(async () => {
  await app.close();
});

function ctxFor(userId: string, visibleTaskIds: string[]): ToolCtx {
  return {
    userId,
    timezone: ZONE,
    conversationId: '00000000-0000-4000-8000-000000000008',
    page: { section: 'today', listId: 'smart:today', visibleTaskIds, visibleTruncated: false },
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

async function syncBlock(token: string) {
  return injectJson(app, {
    method: 'POST',
    url: '/api/v1/tasks/device-calendar',
    token,
    payload: {
      source: 'ios',
      windowStart: SPAN.windowStart,
      windowEnd: SPAN.windowEnd,
      events: [
        {
          key: 'ios:p8-block',
          title: '整天会',
          start: START,
          end: END,
          allDay: false,
        },
      ],
    },
  });
}

describe('tasks.propose_schedule', () => {
  it('keeps 放不下 on the card, then writes only the fitting task time', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    expect(entity.timezone).toBe(ZONE);
    const list = await inboxId(app, alice.token);
    const synced = await syncBlock(alice.token);
    expect(synced.statusCode).toBe(200);
    expect(synced.json()).toEqual({ created: 1, updated: 0, removed: 0 });

    const write = await createTask(alice.id, { title: '写方案', listId: list, priority: 0 });
    const mail = await createTask(alice.id, {
      title: '回邮件',
      listId: list,
      priority: 1,
      estimateMinutes: 30,
    });
    const long = await createTask(alice.id, {
      title: '整理材料',
      listId: list,
      priority: 2,
      estimateMinutes: 90,
    });
    const ctx = ctxFor(alice.id, [write.id, mail.id, long.id]);
    const asked = await answerScheduleRequest(ctx, '帮我把这几件塞进周四', NOW);
    expect(asked.text).toContain(`周四是 ${DAY}（${ZONE}）`);
    expect(asked.text).toContain('不会写入系统日历');
    expect(asked.card?.status).toBe('preview');
    if (asked.card?.status !== 'preview') return;
    expect(asked.card.summary).toContain('确认后改 1 条');
    expect(asked.card.summary).toContain('其余放不下');
    const byTitle = new Map(asked.card.diffs?.map((diff) => [diff.title, diff]));
    expect(byTitle.get('写方案')?.changes).toEqual([
      { label: '时段', before: '未排', after: '17:30–18:00' },
    ]);
    expect(byTitle.get('回邮件')?.changes).toEqual([{ label: '时段', before: '未排', after: '放不下' }]);
    expect(byTitle.get('整理材料')?.changes).toEqual([{ label: '时段', before: '未排', after: '放不下' }]);
    expect((await getTask(alice.id, write.id)).startAt).toBeNull();

    const [calendarBefore] = await getDb().select().from(tasks).where(eq(tasks.calendarKey, 'ios:p8-block'));
    expect(calendarBefore?.startAt?.toISOString()).toBe(START);
    expect(calendarBefore?.dueAt?.toISOString()).toBe(START);
    expect(calendarBefore?.calendarEndAt?.toISOString()).toBe(END);

    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${asked.card.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ applied: 1, skipped: [] });

    const scheduled = await getTask(alice.id, write.id);
    expect(scheduled.startAt).toBe(SLOT_START);
    expect(scheduled.dueAt).toBe(SLOT_END);
    expect(scheduled.agentScheduled).toBe(true);
    expect(scheduled.calendarKey).toBeNull();
    expect((await getTask(alice.id, mail.id)).dueAt).toBeNull();
    expect((await getTask(alice.id, mail.id)).agentScheduled).toBe(false);
    expect((await getTask(alice.id, long.id)).startAt).toBeNull();

    const [calendarAfter] = await getDb().select().from(tasks).where(eq(tasks.id, present(calendarBefore).id));
    expect(calendarAfter?.calendarKey).toBe('ios:p8-block');
    expect(calendarAfter?.title).toBe('整天会');
    expect(calendarAfter?.startAt?.toISOString()).toBe(START);
    expect(calendarAfter?.dueAt?.toISOString()).toBe(START);
    expect(calendarAfter?.calendarEndAt?.toISOString()).toBe(END);
    expect(calendarAfter?.updatedAt.toISOString()).toBe(calendarBefore?.updatedAt.toISOString());

    const undo = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/undo',
      token: alice.token,
      payload: { hintId: applied.json().undoHintId },
    });
    expect(undo.statusCode).toBe(200);
    const restored = await getTask(alice.id, write.id);
    expect(restored.startAt).toBeNull();
    expect(restored.dueAt).toBeNull();
    expect(restored.agentScheduled).toBe(false);
    const [calendarStill] = await getDb().select().from(tasks).where(eq(tasks.id, present(calendarBefore).id));
    expect(calendarStill?.calendarEndAt?.toISOString()).toBe(END);
    expect(calendarStill?.updatedAt.toISOString()).toBe(calendarBefore?.updatedAt.toISOString());
  });

  it('does not propose a card when automatic suggestions are off', async () => {
    const alice = await registerUser(app);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '写方案', listId: list, priority: 0 });
    const off = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: { notifications: { scheduleSuggest: false } },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().notifications.scheduleSuggest).toBe(false);
    const ctx = ctxFor(alice.id, [task.id]);
    const result = await runTool('tasks.propose_schedule', ctx, { day: DAY, taskIds: [task.id] });
    expect(result).toMatchObject({ status: 'needs_input', question: SCHEDULE_OFF_TEXT });
    expect((await getTask(alice.id, task.id)).startAt).toBeNull();
    expect((await getTask(alice.id, task.id)).agentScheduled).toBe(false);
  });
});
