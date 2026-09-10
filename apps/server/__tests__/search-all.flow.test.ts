/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions */
/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked on fake client methods */
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFastify } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { outcomes } from '../src/db/schema.js';
import { waitForIndexIdle } from '../src/retrieval/pipeline.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type MeiliClient,
} from '../src/retrieval/registry.js';
import { INBOX_INDEX, OUTCOMES_INDEX, syncSearchIndexes } from '../src/retrieval/search.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { registerUser } from './helpers/session.js';

let app: FastifyInstance;

function fakeMeili(overrides: Partial<MeiliClient> = {}): MeiliClient {
  return {
    ensureIndex: vi.fn<MeiliClient['ensureIndex']>().mockResolvedValue(undefined),
    upsertDocuments: vi.fn<MeiliClient['upsertDocuments']>().mockResolvedValue(undefined),
    deleteDocuments: vi.fn<MeiliClient['deleteDocuments']>().mockResolvedValue(undefined),
    search: vi.fn<MeiliClient['search']>().mockResolvedValue([]),
    multiSearch: vi.fn<MeiliClient['multiSearch']>().mockResolvedValue({}),
    listDocuments: vi.fn<MeiliClient['listDocuments']>().mockResolvedValue({ results: [], total: 0 }),
    ...overrides,
  };
}

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterEach(async () => {
  await waitForIndexIdle();
  resetRetrievalClientsForTest();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/search (Meili 全局快搜)', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await injectJson(app, { method: 'GET', url: '/api/v1/search?q=x' });
    expect(res.statusCode).toBe(401);
  });

  it('validates q and limit', async () => {
    const alice = await registerUser(app);
    const cases = [
      '/api/v1/search',
      '/api/v1/search?q=',
      `/api/v1/search?q=${'x'.repeat(101)}`,
      '/api/v1/search?q=x&limit=0',
      '/api/v1/search?q=x&limit=21',
      '/api/v1/search?q=x&limit=abc',
    ];
    for (const url of cases) {
      const res = await injectJson(app, { method: 'GET', url, token: alice.token });
      expect(res.statusCode, url).toBe(400);
    }
  });

  it('returns empty groups when meilisearch is not configured', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/search?q=牛奶',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tasks: [], outcomes: [], inbox: [] });
  });

  it('returns grouped slim hits filtered to the calling user', async () => {
    const alice = await registerUser(app);
    const meili = fakeMeili({
      multiSearch: vi.fn<MeiliClient['multiSearch']>().mockResolvedValue({
        tasks: [{ id: 't1', title: '买牛奶', status: 'todo', listId: 'l1' }],
        outcomes: [{ id: 'o1', name: '健康饮食', status: 'open' }],
        inbox: [{ id: 'i1', title: '牛奶测评', excerpt: '乳品', status: 'unread' }],
      }),
    });
    setRetrievalClientsForTest({ meili });

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/search?q=牛奶&limit=3',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tasks: [{ id: 't1', listId: 'l1', title: '买牛奶', status: 'todo' }],
      outcomes: [{ id: 'o1', name: '健康饮食', status: 'open' }],
      inbox: [{ id: 'i1', title: '牛奶测评', excerpt: '乳品' }],
    });
    const queries = vi.mocked(meili.multiSearch).mock.calls[0]![0];
    for (const query of queries) {
      expect(query.filter).toBe(`userId = '${alice.id}'`);
      expect(query.limit).toBe(3);
    }
  });

  it('degrades to empty groups when meili fails', async () => {
    const alice = await registerUser(app);
    const meili = fakeMeili({
      multiSearch: vi.fn<MeiliClient['multiSearch']>().mockRejectedValue(new Error('down')),
    });
    setRetrievalClientsForTest({ meili });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/search?q=x',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tasks: [], outcomes: [], inbox: [] });
    spy.mockRestore();
  });
});

describe('outcome index hooks', () => {
  it('indexes on create, rename and close; removes on undo', async () => {
    const alice = await registerUser(app);
    const meili = fakeMeili();
    setRetrievalClientsForTest({ meili });

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/outcomes',
      token: alice.token,
      payload: { name: '换工作' },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    await waitForIndexIdle();
    expect(meili.upsertDocuments).toHaveBeenCalledWith(OUTCOMES_INDEX, [
      { id, userId: alice.id, type: 'outcome', name: '换工作', status: 'open' },
    ]);

    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/outcomes/${id}`,
      token: alice.token,
      payload: { name: '换工作（2026）' },
    });
    await waitForIndexIdle();
    expect(meili.upsertDocuments).toHaveBeenLastCalledWith(OUTCOMES_INDEX, [
      { id, userId: alice.id, type: 'outcome', name: '换工作（2026）', status: 'open' },
    ]);

    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/close`,
      token: alice.token,
    });
    await waitForIndexIdle();
    expect(meili.upsertDocuments).toHaveBeenLastCalledWith(OUTCOMES_INDEX, [
      { id, userId: alice.id, type: 'outcome', name: '换工作（2026）', status: 'closed' },
    ]);

    // undo only applies to agent-created threads inside the undo window — seed one.
    const agentId = '00000000-0000-4000-8000-0000000000a1';
    await getDb().insert(outcomes).values({
      id: agentId,
      userId: alice.id,
      name: '系统建的线程',
      createdBy: 'agent',
      undoUntil: new Date(Date.now() + 3600_000),
    });
    vi.mocked(meili.upsertDocuments).mockClear();
    const undone = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${agentId}/undo`,
      token: alice.token,
    });
    expect(undone.statusCode).toBe(200);
    await waitForIndexIdle();
    expect(meili.deleteDocuments).toHaveBeenCalledWith(OUTCOMES_INDEX, [agentId]);
    expect(meili.upsertDocuments).not.toHaveBeenCalled();
  });
});

describe('inbox index hooks', () => {
  it('indexes on create and patch; removes on delete', async () => {
    const alice = await registerUser(app);
    const meili = fakeMeili();
    setRetrievalClientsForTest({ meili });

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: '一篇文章', excerpt: '摘要' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    await waitForIndexIdle();
    expect(meili.upsertDocuments).toHaveBeenCalledWith(INBOX_INDEX, [
      { id, userId: alice.id, type: 'inbox', title: '一篇文章', excerpt: '摘要', status: 'unread' },
    ]);

    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/inbox/${id}`,
      token: alice.token,
      payload: { title: '一篇文章（改）' },
    });
    await waitForIndexIdle();
    expect(meili.upsertDocuments).toHaveBeenLastCalledWith(INBOX_INDEX, [
      {
        id,
        userId: alice.id,
        type: 'inbox',
        title: '一篇文章（改）',
        excerpt: '摘要',
        status: 'unread',
      },
    ]);

    const deleted = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/inbox/${id}`,
      token: alice.token,
    });
    expect(deleted.statusCode).toBe(204);
    await waitForIndexIdle();
    expect(meili.deleteDocuments).toHaveBeenCalledWith(INBOX_INDEX, [id]);
  });
});

describe('syncSearchIndexes', () => {
  it('re-upserts live rows and prunes ids PostgreSQL no longer has', async () => {
    const alice = await registerUser(app);
    const meili = fakeMeili({
      listDocuments: vi.fn<MeiliClient['listDocuments']>().mockResolvedValue({
        results: [{ id: 'stale-1' }],
        total: 1,
      }),
    });
    setRetrievalClientsForTest({ meili });

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/outcomes',
      token: alice.token,
      payload: { name: '同步线程' },
    });
    const outcomeId = created.json().id as string;
    const inbox = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: '同步条目' },
    });
    const inboxId = inbox.json().id as string;
    await waitForIndexIdle();
    vi.mocked(meili.upsertDocuments).mockClear();

    const stats = await syncSearchIndexes(alice.id);

    // One live outcome + one live inbox item re-upserted; one stale id pruned
    // from each index.
    expect(stats).toEqual({ outcomes: 1, inbox: 1, removed: 2 });
    expect(meili.upsertDocuments).toHaveBeenCalledWith(OUTCOMES_INDEX, [
      { id: outcomeId, userId: alice.id, type: 'outcome', name: '同步线程', status: 'open' },
    ]);
    expect(meili.upsertDocuments).toHaveBeenCalledWith(INBOX_INDEX, [
      {
        id: inboxId,
        userId: alice.id,
        type: 'inbox',
        title: '同步条目',
        excerpt: null,
        status: 'unread',
      },
    ]);
    // Both indexes enumerate the user's docs and prune the stale id.
    expect(meili.deleteDocuments).toHaveBeenCalledWith(OUTCOMES_INDEX, ['stale-1']);
    expect(meili.deleteDocuments).toHaveBeenCalledWith(INBOX_INDEX, ['stale-1']);
  });

  it('is a no-op when meili is not configured', async () => {
    setRetrievalClientsForTest({ meili: null });
    await expect(syncSearchIndexes('u-none')).resolves.toEqual({ outcomes: 0, inbox: 0, removed: 0 });
  });
});
