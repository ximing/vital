import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { buildFastify } from '../../src/app.js';
import { findTool, toAgentTool } from '../../src/agent/chat/registry.js';
import { answerMilestoneRequest, setMilestoneSplitChooser } from '../../src/agent/chat/tools/milestones.js';
import { screenPlan } from '../../src/agent/chat/tools/plan.js';
import { MAX_TOOL_ROUNDS, PLAN_MAX, PLAN_TTL_MS, type ToolCtx, type ToolResult } from '../../src/agent/chat/types.js';
import { getDb } from '../../src/db/index.js';
import { agentChatPreviews, agentEditEvents, taskCompletions, tasks } from '../../src/db/schema.js';
import { createHabit, ensureOpenTodayInstance } from '../../src/habits/habits.service.js';
import { createOutcome } from '../../src/outcomes/outcomes.service.js';
import { createTask, deleteTask, getTask, patchTask } from '../../src/tasks/tasks.service.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

afterAll(async () => {
  await app.close();
});

function ctxFor(userId: string, timezone: string, visibleTaskIds: string[] = []): ToolCtx {
  return {
    userId,
    timezone,
    conversationId: randomUUID(),
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

function ymdOf(iso: string | null, zone: string): string | null {
  if (!iso) return null;
  return DateTime.fromISO(iso).setZone(zone).toFormat('yyyy-MM-dd');
}

async function previewStatus(id: string): Promise<string | undefined> {
  const [row] = await getDb().select().from(agentChatPreviews).where(eq(agentChatPreviews.id, id)).limit(1);
  return row?.status;
}

describe('tasks.propose_plan', () => {
  it('builds a preview and does not write tasks', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '写周报', listId: list });
    const ctx = ctxFor(alice.id, entity.timezone);
    const result = await runTool('tasks.propose_plan', ctx, {
      patches: [{ taskId: task.id, title: '交周报', priority: 1, dueYmd: '2026-10-21' }],
    });
    expect(result).toMatchObject({ status: 'preview', summary: '确认后改 1 条' });
    if (result.status !== 'preview') return;
    expect(result.diffs?.[0]).toMatchObject({
      taskId: task.id,
      title: '写周报',
      changes: [
        { label: '标题', before: '写周报', after: '交周报' },
        { label: '日期', before: '无日期', after: '2026-10-21' },
        { label: '优先级', before: 'P3', after: 'P1' },
      ],
    });
    const ttl = Date.parse(result.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(PLAN_TTL_MS + 5_000);
    expect(ctx.domainMutated.value).toBe(false);
    expect(ctx.gate.plan?.previewId).toBe(result.previewId);
    expect((await getTask(alice.id, task.id)).title).toBe('写周报');
  });

  it('expires an open plan without changing the task', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '过期任务', listId: list });
    const ctx = ctxFor(alice.id, entity.timezone);
    const result = await runTool('tasks.propose_plan', ctx, {
      patches: [{ taskId: task.id, title: '不该生效' }],
    });
    if (result.status !== 'preview') throw new Error(JSON.stringify(result));
    await getDb()
      .update(agentChatPreviews)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(agentChatPreviews.id, result.previewId));
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${result.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(409);
    expect(applied.json().error.code).toBe('CHAT_PREVIEW_CLOSED');
    expect(await previewStatus(result.previewId)).toBe('expired');
    expect((await getTask(alice.id, task.id)).title).toBe('过期任务');
  });

  it('skips a revision conflict, consumes the plan, and offers no undo', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '原标题', listId: list });
    const ctx = ctxFor(alice.id, entity.timezone);
    const result = await runTool('tasks.propose_plan', ctx, {
      patches: [{ taskId: task.id, title: '方案标题' }],
    });
    if (result.status !== 'preview') throw new Error(JSON.stringify(result));
    await patchTask(alice.id, task.id, { title: '外部改过' });
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${result.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ applied: 0, undoHintId: null });
    expect(applied.json().skipped[0].reason).toContain('改过');
    expect(await previewStatus(result.previewId)).toBe('applied');
    expect((await getTask(alice.id, task.id)).title).toBe('外部改过');
    const again = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${result.previewId}/apply`,
      token: alice.token,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CHAT_PREVIEW_CLOSED');
  });

  it('applies the clean rows and skips a stale row and a deleted row', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const keep = await createTask(alice.id, { title: '留下', listId: list });
    const stale = await createTask(alice.id, { title: '会过期', listId: list });
    const gone = await createTask(alice.id, { title: '会删掉', listId: list });
    const ctx = ctxFor(alice.id, entity.timezone);
    const result = await runTool('tasks.propose_plan', ctx, {
      patches: [
        { taskId: keep.id, title: '留下-已改' },
        { taskId: stale.id, title: '会过期-方案' },
        { taskId: gone.id, title: '会删掉-方案' },
      ],
    });
    if (result.status !== 'preview') throw new Error(JSON.stringify(result));
    await patchTask(alice.id, stale.id, { title: '外部标题' });
    await deleteTask(alice.id, gone.id);
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${result.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(1);
    const skipped = applied.json().skipped as { taskId: string; reason: string }[];
    expect(skipped.find((item) => item.taskId === stale.id)?.reason).toContain('改过');
    expect(skipped.find((item) => item.taskId === gone.id)?.reason).toContain('不在了');
    expect((await getTask(alice.id, keep.id)).title).toBe('留下-已改');
    expect((await getTask(alice.id, stale.id)).title).toBe('外部标题');
    const [removed] = await getDb().select().from(tasks).where(eq(tasks.id, gone.id)).limit(1);
    expect(removed?.deletedAt).toBeTruthy();
    const events = await getDb()
      .select()
      .from(agentEditEvents)
      .where(and(eq(agentEditEvents.userId, alice.id), eq(agentEditEvents.source, 'agent')));
    expect(events.map((row) => row.entityId)).toEqual([keep.id]);
  });

  it('applies title, date, priority, outcome, and completion, then undoes the whole plan', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const outcome = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/outcomes',
      token: alice.token,
      payload: { name: '本周交付' },
    });
    expect(outcome.statusCode).toBe(200);
    const outcomeId = outcome.json().id as string;
    const main = await createTask(alice.id, { title: '写周报', listId: list });
    const done = await createTask(alice.id, { title: '买咖啡', listId: list });
    const ctx = ctxFor(alice.id, entity.timezone);
    const result = await runTool('tasks.propose_plan', ctx, {
      patches: [
        {
          taskId: main.id,
          title: '交周报',
          dueYmd: '2026-10-21',
          priority: 1,
          outcomeId,
          status: 'doing',
        },
        { taskId: done.id, status: 'done' },
      ],
    });
    if (result.status !== 'preview') throw new Error(JSON.stringify(result));
    expect(result.diffs?.find((diff) => diff.taskId === main.id)?.changes).toEqual(
      expect.arrayContaining([
        { label: '标题', before: '写周报', after: '交周报' },
        { label: '日期', before: '无日期', after: '2026-10-21' },
        { label: '优先级', before: 'P3', after: 'P1' },
        { label: '归属', before: '无', after: '本周交付' },
        { label: '状态', before: '待办', after: '进行中' },
      ]),
    );
    expect((await getTask(alice.id, main.id)).title).toBe('写周报');
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${result.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ applied: 2, skipped: [] });
    const undoHintId = applied.json().undoHintId as string;
    expect(undoHintId).toBeTruthy();
    const after = await getTask(alice.id, main.id);
    expect(after.title).toBe('交周报');
    expect(after.priority).toBe(1);
    expect(after.status).toBe('doing');
    expect(after.outcomeId).toBe(outcomeId);
    expect(ymdOf(after.dueAt, entity.timezone)).toBe('2026-10-21');
    expect((await getTask(alice.id, done.id)).status).toBe('done');
    const completions = await getDb().select().from(taskCompletions).where(eq(taskCompletions.taskId, done.id));
    expect(completions).toHaveLength(1);
    const agentEvents = await getDb()
      .select()
      .from(agentEditEvents)
      .where(and(eq(agentEditEvents.userId, alice.id), eq(agentEditEvents.source, 'agent')));
    expect(agentEvents.map((row) => row.entityId).sort()).toEqual([done.id, main.id].sort());
    const undo = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/undo',
      token: alice.token,
      payload: { hintId: undoHintId },
    });
    expect(undo.statusCode).toBe(200);
    const restored = await getTask(alice.id, main.id);
    expect(restored.title).toBe('写周报');
    expect(restored.priority).toBe(3);
    expect(restored.status).toBe('todo');
    expect(restored.outcomeId).toBeNull();
    expect(restored.dueAt).toBeNull();
    expect((await getTask(alice.id, done.id)).status).toBe('todo');
    const left = await getDb().select().from(taskCompletions).where(eq(taskCompletions.taskId, done.id));
    expect(left).toHaveLength(0);
  });

  it('still writes one direct mutate and refuses a second in the same turn', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '直接改', listId: list });
    const ctx = ctxFor(alice.id, entity.timezone);
    const first = await runTool('tasks.patch', ctx, { taskId: task.id, priority: 1 });
    expect(first).toMatchObject({ status: 'ok' });
    expect(ctx.gate.mutated).toBe(true);
    expect(ctx.domainMutated.value).toBe(true);
    expect((await getTask(alice.id, task.id)).priority).toBe(1);
    const second = await runTool('tasks.complete', ctx, { taskId: task.id });
    expect(second).toEqual({ status: 'needs_input', question: '一次只能改一件。要改多条请用 tasks.organize。' });
    expect((await getTask(alice.id, task.id)).status).toBe('todo');
    expect((await getTask(alice.id, task.id)).priority).toBe(1);
    const planned = await runTool('tasks.propose_plan', ctx, {
      patches: [{ taskId: task.id, title: '不该出方案' }],
    });
    expect(planned).toEqual({ status: 'needs_input', question: '这一轮已经直接改过一条。要出方案请重新开口。' });
    expect((await getTask(alice.id, task.id)).title).toBe('直接改');
  });

  it('folds a later patch into the open plan and applies the merge', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '合并前', listId: list });
    const ctx = ctxFor(alice.id, entity.timezone);
    const opened = await runTool('tasks.propose_plan', ctx, {
      patches: [{ taskId: task.id, title: '合并后' }],
    });
    if (opened.status !== 'preview') throw new Error(JSON.stringify(opened));
    const folded = await runTool('tasks.patch', ctx, { taskId: task.id, priority: 1 });
    expect(folded).toMatchObject({ status: 'preview', previewId: opened.previewId });
    expect(ctx.domainMutated.value).toBe(false);
    const [row] = await getDb().select().from(agentChatPreviews).where(eq(agentChatPreviews.id, opened.previewId));
    const stored = row?.args as { patches: { title?: string; priority?: number }[] };
    expect(stored.patches[0]).toMatchObject({ title: '合并后', priority: 1 });
    expect((await getTask(alice.id, task.id)).title).toBe('合并前');
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${opened.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(1);
    const next = await getTask(alice.id, task.id);
    expect(next.title).toBe('合并后');
    expect(next.priority).toBe(1);
  });

  it('refuses create_from_text while a plan is open', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '已有', listId: list });
    const ctx = ctxFor(alice.id, entity.timezone);
    const opened = await runTool('tasks.propose_plan', ctx, {
      patches: [{ taskId: task.id, title: '改名' }],
    });
    expect(opened.status).toBe('preview');
    const before = await getDb().select().from(tasks).where(eq(tasks.userId, alice.id));
    const blocked = await runTool('tasks.create_from_text', ctx, { text: '新的一条' });
    expect(blocked).toEqual({
      status: 'needs_input',
      question: '方案里只改已有待办的标题、日期、优先级、状态和归属。',
    });
    const after = await getDb().select().from(tasks).where(eq(tasks.userId, alice.id));
    expect(after).toHaveLength(before.length);
  });

  it('does not let the organize endpoint consume a plan, or the plan endpoint consume an organize preview', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const planned = await createTask(alice.id, { title: '方案条', listId: list });
    const organized = await createTask(alice.id, { title: '整理条', listId: list });
    const planCtx = ctxFor(alice.id, entity.timezone);
    const plan = await runTool('tasks.propose_plan', planCtx, {
      patches: [{ taskId: planned.id, title: '方案已改' }],
    });
    if (plan.status !== 'preview') throw new Error(JSON.stringify(plan));
    const organizeCtx = ctxFor(alice.id, entity.timezone, [organized.id]);
    const organize = await runTool('tasks.organize', organizeCtx, {
      ops: [{ taskId: organized.id, priority: 1 }],
    });
    if (organize.status !== 'preview') throw new Error(JSON.stringify(organize));

    const planOnOrganize = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/chat/previews/${plan.previewId}/apply`,
      token: alice.token,
    });
    expect(planOnOrganize.statusCode).toBe(409);
    expect(await previewStatus(plan.previewId)).toBe('open');
    const organizeOnPlan = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${organize.previewId}/apply`,
      token: alice.token,
    });
    expect(organizeOnPlan.statusCode).toBe(409);
    expect(await previewStatus(organize.previewId)).toBe('open');

    const planApplied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${plan.previewId}/apply`,
      token: alice.token,
    });
    expect(planApplied.statusCode).toBe(200);
    expect((await getTask(alice.id, planned.id)).title).toBe('方案已改');
    const organizeApplied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/chat/previews/${organize.previewId}/apply`,
      token: alice.token,
    });
    expect(organizeApplied.statusCode).toBe(200);
    expect((await getTask(alice.id, organized.id)).priority).toBe(1);
  });

  it('caps a turn at 12 tool calls and a plan at 20 patches, and rejects habits up front', async () => {
    expect(MAX_TOOL_ROUNDS).toBe(12);
    expect(PLAN_MAX).toBe(20);
    expect(PLAN_TTL_MS).toBe(15 * 60_000);
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const ctx = ctxFor(alice.id, entity.timezone);
    const tooMany = await screenPlan(
      ctx,
      Array.from({ length: 21 }, () => ({ taskId: randomUUID(), priority: 1 as const })),
    );
    expect(tooMany).toEqual({ status: 'needs_input', question: '一份方案最多 20 条。' });
    const habit = await createHabit(alice.id, { name: '喝水', kind: 'daily' }, 'agent');
    const instanceId = await ensureOpenTodayInstance(alice.id, habit.id, entity.timezone);
    expect(instanceId).toBeTruthy();
    const blocked = await screenPlan(ctx, [{ taskId: instanceId ?? randomUUID(), priority: 1 }]);
    expect(blocked).toMatchObject({ status: 'needs_input' });
    if ('question' in blocked) expect(blocked.question).toContain('习惯');
  });

  it('previews an isMilestone patch and writes the column only after confirm', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const outcome = await createOutcome(alice.id, { name: 'P11验收目标' });
    const task = await createTask(alice.id, { title: '交大纲', listId: list, outcomeId: outcome.id });
    const ctx = ctxFor(alice.id, entity.timezone);
    const result = await runTool('tasks.propose_plan', ctx, {
      patches: [{ taskId: task.id, isMilestone: true }],
    });
    expect(result).toMatchObject({ status: 'preview' });
    if (result.status !== 'preview') return;
    expect(result.diffs?.[0]?.changes).toEqual([{ label: '里程碑', before: '否', after: '是' }]);
    expect((await getTask(alice.id, task.id)).isMilestone).toBe(false);
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${result.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect((await getTask(alice.id, task.id)).isMilestone).toBe(true);
  });

  it('refuses to mark a task that has no outcome', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '没有目标', listId: list });
    const blocked = await screenPlan(ctxFor(alice.id, entity.timezone), [
      { taskId: task.id, isMilestone: true },
    ]);
    expect(blocked).toMatchObject({ status: 'needs_input' });
    if ('question' in blocked) expect(blocked.question).toContain('没有归属目标');
    expect((await getTask(alice.id, task.id)).isMilestone).toBe(false);
  });
});

describe('milestone split plan card', () => {
  afterEach(() => {
    setMilestoneSplitChooser(null);
  });

  it('says the chat model is not configured and does not write', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const outcome = await createOutcome(alice.id, { name: 'P11验收目标' });
    const task = await createTask(alice.id, { title: '交大纲', listId: list, outcomeId: outcome.id });
    const ctx = ctxFor(alice.id, entity.timezone);
    ctx.page.outcomeId = outcome.id;
    const answer = await answerMilestoneRequest(ctx, '把这个目标拆成里程碑');
    expect(answer.card).toBeNull();
    expect(answer.text).toContain('还没有配置');
    expect((await getTask(alice.id, task.id)).isMilestone).toBe(false);
  });

  it('builds a plan card from the chooser and waits for confirm', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const outcome = await createOutcome(alice.id, { name: 'P11验收目标' });
    const task = await createTask(alice.id, { title: '交大纲', listId: list, outcomeId: outcome.id });
    setMilestoneSplitChooser(() => [task.id]);
    const ctx = ctxFor(alice.id, entity.timezone);
    ctx.page.outcomeId = outcome.id;
    const answer = await answerMilestoneRequest(ctx, '把这个目标拆成里程碑');
    expect(answer.text).toContain('确认后才会把这些待办标成里程碑');
    expect(answer.card).toMatchObject({ status: 'preview' });
    if (answer.card?.status !== 'preview') return;
    expect(answer.card.diffs?.[0]?.changes).toEqual([{ label: '里程碑', before: '否', after: '是' }]);
    expect((await getTask(alice.id, task.id)).isMilestone).toBe(false);
    const applied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/plans/${answer.card.previewId}/apply`,
      token: alice.token,
    });
    expect(applied.statusCode).toBe(200);
    expect((await getTask(alice.id, task.id)).isMilestone).toBe(true);
  });
});
