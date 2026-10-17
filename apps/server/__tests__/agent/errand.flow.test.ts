/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findTool, toAgentTool } from '../../src/agent/chat/registry.js';
import '../../src/agent/chat/tools/errands.js';
import type { ToolCtx, ToolResult } from '../../src/agent/chat/types.js';
import {
  ERRAND_DONE_TITLE,
  ERRAND_FAILED_TITLE,
  resetErrandForTests,
  setErrandCallsAlreadyUsed,
  startOrganizeErrand,
} from '../../src/agent/errand.js';
import { processDueAgentJobs } from '../../src/agent/jobs.js';
import { DEMAND_ONLY_JOB_TYPES } from '../../src/agent/scheduler.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import {
  agentActions,
  agentJobs,
  agentUsage,
  inboxItemTags,
  inboxItems,
  notificationOutbox,
  tags,
  taskCompletions,
  tasks,
  users,
} from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

const SUMMARY = '第一句。\n第二句。\n第三句。';
const ZONE = 'Asia/Shanghai';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterEach(() => {
  setPiResolveOverride(null);
  resetErrandForTests();
});

afterAll(async () => {
  await app.close();
});

function installFaux() {
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }] });
  setPiResolveOverride((stored, route, apiKey) => {
    const models = createModels();
    models.setProvider(faux.provider);
    const model = models.getModel('faux', route.model);
    if (!model) return null;
    return { models, model, apiKey, route, stored };
  });
  return faux;
}

async function setupFauxUser(name: string): Promise<{ id: string; token: string }> {
  const user = await registerUser(app, name);
  const added = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/llm/providers',
    token: user.token,
    payload: {
      providerId: 'custom',
      label: '测试网关',
      baseUrl: 'http://faux.test/v1',
      apiKey: 'sk-secret',
      models: ['faux-1'],
    },
  });
  expect(added.statusCode).toBe(200);
  const providerId = added.json().providers[0].id as string;
  const routed = await injectJson(app, {
    method: 'PUT',
    url: '/api/v1/llm/routing',
    token: user.token,
    payload: { routing: { default: { providerId, model: 'faux-1' } } },
  });
  expect(routed.statusCode).toBe(200);
  return user;
}

async function createArticle(
  token: string,
  title: string,
  markdown: string | null,
  excerpt = '旧摘要',
): Promise<string> {
  const created = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/inbox',
    token,
    payload: {
      title,
      source: 'manual',
      ...(markdown !== null ? { markdown, excerpt } : {}),
    },
  });
  expect(created.statusCode).toBe(201);
  return created.json().id as string;
}

async function runDue(): Promise<void> {
  expect(await processDueAgentJobs()).toBeGreaterThan(0);
}

async function taskOf(id: string) {
  const [row] = await getDb().select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row) throw new Error('missing task');
  return row;
}

async function itemOf(id: string) {
  const [row] = await getDb().select().from(inboxItems).where(eq(inboxItems.id, id)).limit(1);
  if (!row) throw new Error('missing inbox');
  return row;
}

function markerCount(notes: string, marker: string): number {
  return notes.split(marker).length - 1;
}

describe('errand.run', () => {
  it('is demand-driven and not part of the weekly scan', () => {
    expect(DEMAND_ONLY_JOB_TYPES).toEqual(['errand.run']);
  });

  it('reads an article, replaces the excerpt, completes the task, and notifies', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([fauxAssistantMessage(SUMMARY)]);
    const inboxId = await createArticle(alice.token, '有正文', '第一段说明了背景。\n\n第二段给出结论。');
    const started = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/errand`,
      token: alice.token,
    });
    expect(started.statusCode).toBe(202);
    const taskId = started.json().taskId as string;
    await runDue();

    expect(faux.state.callCount).toBe(1);
    const item = await itemOf(inboxId);
    expect(item.excerpt).toBe(SUMMARY);
    expect(item.excerpt).not.toContain('旧摘要');
    expect(item.status).not.toBe('converted');
    const task = await taskOf(taskId);
    expect(task.status).toBe('done');
    expect(task.notesMd).toContain('代办 · 已读完');
    expect(task.notesMd).toContain(SUMMARY);
    expect(markerCount(task.notesMd, `<!-- errand:read:${inboxId} -->`)).toBe(1);
    const completions = await getDb().select().from(taskCompletions).where(eq(taskCompletions.taskId, taskId));
    expect(completions).toHaveLength(1);
    const actions = await getDb().select().from(agentActions).where(eq(agentActions.targetId, taskId));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ actionType: 'errand.summarize', feedback: 'accepted' });
    const [job] = await getDb()
      .select()
      .from(agentJobs)
      .where(and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, 'errand.run')));
    expect(job).toMatchObject({ jobType: 'errand.run', status: 'done', lastError: null });
    const [notice] = await getDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.entityId, taskId));
    expect(notice?.eventType).toBe('agent.errand');
    expect(notice?.payload.title).toBe(ERRAND_DONE_TITLE);
    expect(notice?.payload.title).not.toContain('晨报');
    expect(notice?.payload.deeplink).toBe(`/inbox/${inboxId}`);
    expect(notice?.payload.message).toContain('第一句');
    const usage = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
    expect(usage.some((row) => row.capability === 'errand' && row.status === 'succeeded')).toBe(true);
  });

  it('does not write the summary again when the same read runs twice', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([fauxAssistantMessage(SUMMARY), fauxAssistantMessage('不该再写一行。')]);
    const inboxId = await createArticle(alice.token, '有正文', '只要这一段。');
    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/errand`,
      token: alice.token,
    });
    const taskId = first.json().taskId as string;
    await runDue();
    const again = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/errand`,
      token: alice.token,
    });
    expect(again.json().taskId).toBe(taskId);
    await runDue();
    expect(faux.state.callCount).toBe(1);
    expect((await itemOf(inboxId)).excerpt).toBe(SUMMARY);
    const task = await taskOf(taskId);
    expect(markerCount(task.notesMd, `<!-- errand:read:${inboxId} -->`)).toBe(1);
    expect(task.notesMd).not.toContain('不该再写');
  });

  it('leaves the task open when the article has no body', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    const inboxId = await createArticle(alice.token, '没有正文', null);
    const started = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/errand`,
      token: alice.token,
    });
    await runDue();
    expect(faux.state.callCount).toBe(0);
    const task = await taskOf(started.json().taskId as string);
    expect(task.status).not.toBe('done');
    expect(task.notesMd).toContain('这篇没有正文');
    expect(task.notesMd).not.toContain('代办 · 已读完');
    const completions = await getDb().select().from(taskCompletions).where(eq(taskCompletions.taskId, task.id));
    expect(completions).toHaveLength(0);
    const [notice] = await getDb().select().from(notificationOutbox).where(eq(notificationOutbox.entityId, task.id));
    expect(notice?.payload.title).toBe(ERRAND_FAILED_TITLE);
    const [job] = await getDb().select().from(agentJobs).where(eq(agentJobs.id, started.json().jobId as string));
    expect(job).toMatchObject({ status: 'done', lastError: null });
  });

  it('leaves the task open when no model route can answer', async () => {
    const alice = await registerUser(app, 'alice');
    const faux = installFaux();
    const inboxId = await createArticle(alice.token, '有正文', '有正文但没有路由。');
    const started = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/errand`,
      token: alice.token,
    });
    await runDue();
    expect(faux.state.callCount).toBe(0);
    const task = await taskOf(started.json().taskId as string);
    expect(task.status).not.toBe('done');
    expect(task.notesMd).toContain('没有可用的模型');
    expect((await itemOf(inboxId)).excerpt).toBe('旧摘要');
  });

  it('degrades a read to a pending proposal when another model call would pass 3', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    setErrandCallsAlreadyUsed(3);
    const inboxId = await createArticle(alice.token, '有正文', '正文在，但不该再调模型。');
    const started = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/errand`,
      token: alice.token,
    });
    await runDue();
    expect(faux.state.callCount).toBe(0);
    expect((await itemOf(inboxId)).excerpt).toBe('旧摘要');
    const task = await taskOf(started.json().taskId as string);
    expect(task.status).not.toBe('done');
    expect(task.notesMd).toContain('超过 3 次');
    const [action] = await getDb().select().from(agentActions).where(eq(agentActions.targetId, task.id));
    expect(action).toMatchObject({ actionType: 'errand.propose', feedback: 'pending' });
  });

  it('archives and tags a batch, then ignores a second run', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    const first = await createArticle(alice.token, '要归档', '甲');
    const second = await createArticle(alice.token, '要打标签', '乙');
    const plan = JSON.stringify({
      note: '归档一篇，另一篇加上标签。',
      items: [
        { id: first, archive: true, addTags: [] },
        { id: second, archive: false, addTags: ['稍后'] },
      ],
    });
    faux.setResponses([fauxAssistantMessage(plan), fauxAssistantMessage('{"note":"不该再整理","items":[]}')]);
    const ctx: ToolCtx = {
      userId: alice.id,
      timezone: ZONE,
      conversationId: randomUUID(),
      page: { section: 'inbox', visibleTaskIds: [], visibleTruncated: false },
      gate: { mutated: false, plan: null },
      domainMutated: { value: false },
    };
    const tool = findTool('errands.organize');
    if (!tool) throw new Error('missing errands.organize');
    const executed = await toAgentTool(tool, ctx).execute('call', { inboxItemIds: [first, second] });
    const result = executed.details as ToolResult;
    expect(result.status).toBe('ok');
    await runDue();
    expect(faux.state.callCount).toBe(1);
    expect((await itemOf(first)).status).toBe('archived');
    expect((await itemOf(second)).status).toBe('unread');
    const [tag] = await getDb()
      .select()
      .from(tags)
      .where(and(eq(tags.userId, alice.id), eq(tags.name, '稍后')));
    expect(tag).toBeTruthy();
    const links = await getDb().select().from(inboxItemTags).where(eq(inboxItemTags.tagId, tag!.id));
    expect(links.map((link) => link.inboxItemId)).toEqual([second]);
    const taskId = (result.status === 'ok' ? result.data : null) as { taskId: string };
    const task = await taskOf(taskId.taskId);
    expect(task.status).toBe('done');
    expect(task.notesMd).toContain('代办 · 已整理');
    expect(task.notesMd).toContain('归档一篇');
    const [action] = await getDb().select().from(agentActions).where(eq(agentActions.targetId, task.id));
    expect(action).toMatchObject({ actionType: 'errand.organize', feedback: 'accepted' });
    const [notice] = await getDb().select().from(notificationOutbox).where(eq(notificationOutbox.entityId, task.id));
    expect(notice?.eventType).toBe('agent.errand');
    expect(notice?.payload.deeplink).toBe('/inbox');
    expect(notice?.payload.title).toBe(ERRAND_DONE_TITLE);

    const again = await toAgentTool(tool, { ...ctx, gate: { mutated: false, plan: null } }).execute('call', {
      inboxItemIds: [second, first],
    });
    expect((again.details as ToolResult).status).toBe('ok');
    await runDue();
    expect(faux.state.callCount).toBe(1);
    expect(markerCount( (await taskOf(task.id)).notesMd, `<!-- errand:organize:${task.id} -->`)).toBe(1);
    const linksAfter = await getDb().select().from(inboxItemTags).where(eq(inboxItemTags.tagId, tag!.id));
    expect(linksAfter).toHaveLength(1);
  });

  it('does not organize when no model is routed', async () => {
    const alice = await registerUser(app, 'alice');
    const faux = installFaux();
    const id = await createArticle(alice.token, '待整理', '正文');
    const started = await startOrganizeErrand(alice.id, [id], 'chat');
    await runDue();
    expect(faux.state.callCount).toBe(0);
    expect((await itemOf(id)).status).toBe('unread');
    const task = await taskOf(started.taskId);
    expect(task.status).not.toBe('done');
    expect(task.notesMd).toContain('没有可用的模型');
  });

  it('degrades organize to a proposal when 61 items would take a fourth call', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    const ids = Array.from({ length: 61 }, () => randomUUID());
    await getDb().insert(inboxItems).values(
      ids.map((id, index) => ({
        id,
        userId: alice.id,
        title: `条目 ${String(index)}`,
        status: 'unread' as const,
        source: 'manual' as const,
      })),
    );
    const started = await startOrganizeErrand(alice.id, ids, 'chat');
    await runDue();
    expect(faux.state.callCount).toBe(0);
    const live = await getDb().select({ status: inboxItems.status }).from(inboxItems).where(eq(inboxItems.userId, alice.id));
    expect(live.every((row) => row.status === 'unread')).toBe(true);
    const task = await taskOf(started.taskId);
    expect(task.status).not.toBe('done');
    expect(task.notesMd).toContain('超过 3 次');
    const [action] = await getDb().select().from(agentActions).where(eq(agentActions.targetId, task.id));
    expect(action).toMatchObject({ actionType: 'errand.propose', feedback: 'pending' });
  });

  it('still does the work but skips the outbox when the switch is off', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([fauxAssistantMessage(SUMMARY)]);
    await getDb().update(users).set({ notifyAgentErrand: false }).where(eq(users.id, alice.id));
    const inboxId = await createArticle(alice.token, '有正文', '正文。');
    const started = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/errand`,
      token: alice.token,
    });
    await runDue();
    expect(faux.state.callCount).toBe(1);
    expect((await taskOf(started.json().taskId as string)).status).toBe('done');
    const notices = await getDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.userId, alice.id));
    expect(notices.filter((row) => row.eventType === 'agent.errand')).toHaveLength(0);
  });

  it('delays the report through quiet hours', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([fauxAssistantMessage(SUMMARY)]);
    const local = DateTime.now().setZone(ZONE);
    const start = local.minus({ minutes: 30 }).toFormat('HH:mm');
    const end = local.plus({ minutes: 30 }).toFormat('HH:mm');
    const prefs = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: { notifications: { quietHoursStart: start, quietHoursEnd: end } },
    });
    expect(prefs.statusCode).toBe(200);
    const inboxId = await createArticle(alice.token, '有正文', '正文。');
    const started = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/errand`,
      token: alice.token,
    });
    await runDue();
    const [notice] = await getDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.entityId, started.json().taskId as string));
    expect(notice?.payload.title).toBe(ERRAND_DONE_TITLE);
    expect(notice?.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it('reads the open inbox item from chat', async () => {
    const alice = await registerUser(app, 'alice');
    const inboxId = await createArticle(alice.token, '这一篇', '正文。');
    const tool = findTool('errands.read');
    if (!tool) throw new Error('missing errands.read');
    const ctx: ToolCtx = {
      userId: alice.id,
      timezone: ZONE,
      conversationId: randomUUID(),
      page: { section: 'inbox', inboxId, visibleTaskIds: [], visibleTruncated: false },
      gate: { mutated: false, plan: null },
      domainMutated: { value: false },
    };
    const executed = await toAgentTool(tool, ctx).execute('call', {});
    const result = executed.details as ToolResult;
    expect(result.status).toBe('ok');
    const [job] = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    expect(job?.jobType).toBe('errand.run');
    expect(job?.payload).toMatchObject({ kind: 'inbox.read_summarize', inboxItemId: inboxId });
  });

  it('upgrades a delegable converted task and refuses one that is not linked', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([fauxAssistantMessage(SUMMARY)]);
    const inboxId = await createArticle(alice.token, '转成任务', '正文在这里。');
    const converted = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${inboxId}/convert`,
      token: alice.token,
      payload: {},
    });
    expect(converted.statusCode).toBe(201);
    const taskId = converted.json().task.id as string;
    const blocked = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/errand`,
      token: alice.token,
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.message).toContain('可交给 Agent');
    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });
    expect(patched.statusCode).toBe(200);
    const started = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/errand`,
      token: alice.token,
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().taskId).toBe(taskId);
    await runDue();
    expect((await taskOf(taskId)).status).toBe('done');
    expect((await itemOf(inboxId)).excerpt).toBe(SUMMARY);

    const loose = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '没有收集箱', listId: (await taskOf(taskId)).listId },
    });
    const looseId = loose.json().id as string;
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${looseId}`,
      token: alice.token,
      payload: { delegable: true },
    });
    const refused = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${looseId}/errand`,
      token: alice.token,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toContain('没有连着收集箱');
  });
});
