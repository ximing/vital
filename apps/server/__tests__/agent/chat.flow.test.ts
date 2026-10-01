import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentChatBudgets, agentJobs, agentModelBudgets } from '../../src/db/schema.js';
import { releaseChat, tryAcquireChat } from '../../src/agent/chat/lock.js';
import { screenOrganize } from '../../src/agent/chat/tools/organize.js';
import type { ToolCtx } from '../../src/agent/chat/types.js';
import { createHabit, ensureOpenTodayInstance } from '../../src/habits/habits.service.js';
import { createTask } from '../../src/tasks/tasks.service.js';
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
