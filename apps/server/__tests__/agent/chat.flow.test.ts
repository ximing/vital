import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { buildFastify } from '../../src/app.js';
import { deferFollowupIntent } from '../../src/agent/chat/defer-followup.js';
import { getDb } from '../../src/db/index.js';
import { agentChatBudgets, agentJobs, agentModelBudgets, tasks } from '../../src/db/schema.js';
import { releaseChat, tryAcquireChat } from '../../src/agent/chat/lock.js';
import { screenOrganize } from '../../src/agent/chat/tools/organize.js';
import type { ToolCtx } from '../../src/agent/chat/types.js';
import { createHabit, ensureOpenTodayInstance } from '../../src/habits/habits.service.js';
import { createTask, getTask } from '../../src/tasks/tasks.service.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

const page = {
  section: 'today',
  listId: 'smart:today',
  visibleTaskIds: [] as string[],
  visibleTruncated: false,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

afterAll(async () => {
  await app.close();
});

describe('agent chat', () => {
  it('acquires and releases the in-process lock', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(tryAcquireChat(id)).toBe(true);
    expect(tryAcquireChat(id)).toBe(false);
    releaseChat(id);
    expect(tryAcquireChat(id)).toBe(true);
    releaseChat(id);
  });

  it('GET returns the session without requiring a conversation', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, { method: 'GET', url: '/api/v1/agent/chat', token: alice.token });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: true, conversation: null, messages: [] });
  });

  it('answers a missing model with SSE and leaves the next turn free of CHAT_BUSY', async () => {
    const alice = await registerUser(app);
    const beforeBudget = await getDb().select().from(agentModelBudgets).where(eq(agentModelBudgets.userId, alice.id));
    const beforeJobs = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/messages',
      token: alice.token,
      payload: { text: '明天下午三点买牛奶', context: page },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/event-stream');
    expect(res.body).toContain('LLM_NOT_CONFIGURED');
    const again = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/messages',
      token: alice.token,
      payload: { text: '再试一次', context: page },
    });
    expect(again.statusCode).not.toBe(409);
    expect(again.body).toContain('LLM_NOT_CONFIGURED');
    const budgets = await getDb().select().from(agentModelBudgets).where(eq(agentModelBudgets.userId, alice.id));
    const jobs = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    const chatBudget = await getDb().select().from(agentChatBudgets).where(eq(agentChatBudgets.userId, alice.id));
    expect(budgets).toEqual(beforeBudget);
    expect(jobs).toEqual(beforeJobs);
    expect(chatBudget.reduce((sum, row) => sum + row.turns, 0)).toBe(2);
    releaseChat(alice.id);
  });

  it('replies to a bare 撤销 without calling a model', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/messages',
      token: alice.token,
      payload: { text: '撤销', context: page },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBe('请用卡片上的撤销');
    releaseChat(alice.id);
  });

  it('keeps habit instances out of organize and still previews a normal task', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, { title: '买菜', listId: list });
    const habit = await createHabit(alice.id, { name: '喝水', kind: 'daily' }, 'agent');
    const instanceId = await ensureOpenTodayInstance(alice.id, habit.id, entity.timezone);
    expect(instanceId).toBeTruthy();
    const ctx: ToolCtx = {
      userId: alice.id,
      timezone: entity.timezone,
      conversationId: '00000000-0000-4000-8000-000000000002',
      page: {
        section: 'today',
        listId: 'smart:today',
        visibleTaskIds: [task.id, instanceId ?? ''],
        visibleTruncated: false,
      },
      gate: { mutated: false },
      domainMutated: { value: false },
    };
    const blocked = await screenOrganize(ctx, [{ taskId: instanceId ?? task.id, complete: true }]);
    expect(blocked).toMatchObject({ status: 'needs_input' });
    const allowed = await screenOrganize(ctx, [{ taskId: task.id, priority: 1 }]);
    expect(allowed).toMatchObject({ ops: [{ taskId: task.id, priority: 1 }] });
    const truncated = await screenOrganize(
      { ...ctx, page: { ...ctx.page, visibleTaskIds: [], visibleTruncated: true } },
      [{ taskId: task.id, priority: 2 }],
    );
    expect(truncated).toMatchObject({ status: 'needs_input' });
  });
});

describe('defer follow-up replies', () => {
  it('maps the three phrases and ignores them without a task', () => {
    expect(deferFollowupIntent('不做了')).toBe('cancel');
    expect(deferFollowupIntent('不做了。')).toBe('cancel');
    expect(deferFollowupIntent('下周再说')).toBe('defer');
    expect(deferFollowupIntent('帮我拆')).toBe('decompose');
    expect(deferFollowupIntent('帮我拆一下')).toBeNull();
    expect(deferFollowupIntent('今天不做了')).toBeNull();
  });

  it('cancels, defers, and enqueues a manual decompose without a model', async () => {
    const alice = await registerUser(app);
    const entity = await getUserEntity(alice.id);
    const list = await inboxId(app, alice.token);
    const task = await createTask(alice.id, {
      title: '写方案',
      listId: list,
      dueYmd: '2026-09-01',
      timezone: entity.timezone,
    });
    await getDb().update(tasks).set({ deferCount: 3 }).where(eq(tasks.id, task.id));
    const context = { ...page, taskId: task.id };

    const missed = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/messages',
      token: alice.token,
      payload: { text: '不做了', context: page },
    });
    expect(String(missed.headers['content-type'])).toContain('text/event-stream');
    expect(missed.body).toContain('LLM_NOT_CONFIGURED');
    releaseChat(alice.id);

    const canceled = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/messages',
      token: alice.token,
      payload: { text: '不做了。', context },
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().text).toBe('已取消「写方案」。');
    expect((await getTask(alice.id, task.id)).status).toBe('canceled');
    releaseChat(alice.id);

    const again = await createTask(alice.id, {
      title: '写方案',
      listId: list,
      dueYmd: '2026-09-01',
      timezone: entity.timezone,
    });
    await getDb().update(tasks).set({ deferCount: 3 }).where(eq(tasks.id, again.id));
    const before = new Date(again.dueAt ?? 0);
    const deferred = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/messages',
      token: alice.token,
      payload: { text: '下周再说', context: { ...page, taskId: again.id } },
    });
    expect(deferred.json().text).toContain('写方案');
    expect(deferred.json().text).toContain('改到');
    const moved = await getTask(alice.id, again.id);
    expect(moved.status).toBe('todo');
    expect(new Date(moved.dueAt ?? 0).getTime()).toBeGreaterThan(before.getTime());
    expect(moved.deferCount).toBeGreaterThanOrEqual(4);
    releaseChat(alice.id);

    const split = await createTask(alice.id, {
      title: '写方案',
      listId: list,
      dueYmd: '2026-09-01',
      timezone: entity.timezone,
    });
    await getDb().update(tasks).set({ deferCount: 3 }).where(eq(tasks.id, split.id));
    const decomposed = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/chat/messages',
      token: alice.token,
      payload: { text: '帮我拆', context: { ...page, taskId: split.id } },
    });
    expect(decomposed.json().text).toBe('正在拆「写方案」。');
    const jobs = await getDb()
      .select()
      .from(agentJobs)
      .where(and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, 'task.decompose'), eq(agentJobs.dedupKey, `task.decompose:${split.id}`)));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({ taskId: split.id, manual: true, trigger: 'manual' });
    expect(jobs[0]?.status).toBe('pending');
    releaseChat(alice.id);
  });
});
