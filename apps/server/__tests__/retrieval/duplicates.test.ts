/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked on fake client methods */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFastify } from '../../src/app.js';
import {
  findPotentialDuplicates,
  lexicalDuplicateScore,
} from '../../src/retrieval/duplicates.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
  type RerankClient,
} from '../../src/retrieval/registry.js';
import { createTask } from '../../src/tasks/tasks.service.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '../../src');

let app: FastifyInstance;

function fakeEmbedding(): EmbeddingClient {
  return { embedTexts: vi.fn<EmbeddingClient['embedTexts']>().mockResolvedValue([[1, 0, 0]]) };
}

function fakeQdrant(overrides: Partial<QdrantClient> = {}): QdrantClient {
  return {
    ensureCollection: vi.fn(),
    upsertPoints: vi.fn<QdrantClient['upsertPoints']>().mockResolvedValue(undefined),
    queryPoints: vi.fn<QdrantClient['queryPoints']>().mockResolvedValue([]),
    deletePoints: vi.fn<QdrantClient['deletePoints']>().mockResolvedValue(undefined),
    scrollPoints: vi.fn<QdrantClient['scrollPoints']>().mockResolvedValue([]),
    ...overrides,
  };
}

function fakeMeili(): MeiliClient {
  return {
    ensureIndex: vi.fn(),
    upsertDocuments: vi.fn<MeiliClient['upsertDocuments']>().mockResolvedValue(undefined),
    deleteDocuments: vi.fn<MeiliClient['deleteDocuments']>().mockResolvedValue(undefined),
    search: vi.fn<MeiliClient['search']>().mockResolvedValue([]),
    multiSearch: vi.fn(),
    listDocuments: vi.fn<MeiliClient['listDocuments']>().mockResolvedValue({ results: [], total: 0 }),
  };
}

function scoreByTitleRerank(): RerankClient {
  return {
    rerankTexts: vi.fn<RerankClient['rerankTexts']>().mockImplementation((query, documents) =>
      Promise.resolve(
        documents.map((doc, index) => ({
          index,
          score: lexicalDuplicateScore(query, doc) >= 0.5 ? 0.9 : 0.05,
        })),
      ),
    ),
  };
}

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  resetRetrievalClientsForTest();
  setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
});

afterEach(() => {
  resetRetrievalClientsForTest();
});

afterAll(async () => {
  await app.close();
});

describe('lexicalDuplicateScore', () => {
  it('treats trimmed equal titles as duplicates and ignores short overlap', () => {
    expect(lexicalDuplicateScore('提交季度报告', '提交季度报告 ')).toBe(1);
    expect(lexicalDuplicateScore('提交季度报告', '请提交季度报告草稿')).toBeGreaterThan(0.5);
    expect(lexicalDuplicateScore('买菜', '买咖啡')).toBe(0);
  });
});

describe('findPotentialDuplicates', () => {
  it('returns empty for queries shorter than 4 characters', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    await createTask(alice.id, { title: '买菜清单', listId: inbox });
    await expect(findPotentialDuplicates(alice.id, '买菜')).resolves.toEqual([]);
    await expect(findPotentialDuplicates(alice.id, 'abc')).resolves.toEqual([]);
  });

  it('recalls a just-created unindexed task via the SQL window', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    const existing = await createTask(alice.id, { title: '提交季度报告', listId: inbox });
    const hits = await findPotentialDuplicates(alice.id, '提交季度报告 ');
    expect(hits.map((hit) => hit.id)).toEqual([existing.id]);
    expect(hits[0]?.title).toBe('提交季度报告');
  });

  it('merges index hits with the SQL window and reranks, catching index lag', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    const lagged = await createTask(alice.id, { title: '提交季度报告', listId: inbox });
    const indexed = await createTask(alice.id, { title: '写周报', listId: inbox });
    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant({
      queryPoints: vi.fn<QdrantClient['queryPoints']>().mockResolvedValue([
        { id: indexed.id, score: 0.2, payload: { title: '写周报', content: '写周报' } },
      ]),
    });
    const rerank = scoreByTitleRerank();
    setRetrievalClientsForTest({ embedding, qdrant, meili: fakeMeili(), rerank });

    const hits = await findPotentialDuplicates(alice.id, '提交季度报告');
    expect(hits.map((hit) => hit.id)).toEqual([lagged.id]);
    expect(qdrant.queryPoints).toHaveBeenCalled();
    expect(rerank.rerankTexts).toHaveBeenCalled();
  });

  it('returns empty when retrieval clients are missing and nothing lexical-matches', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    await createTask(alice.id, { title: '完全无关的事', listId: inbox });
    await expect(findPotentialDuplicates(alice.id, '提交季度报告')).resolves.toEqual([]);
  });

  it('swallows infra errors and still returns SQL-window hits', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    const existing = await createTask(alice.id, { title: '提交季度报告', listId: inbox });
    const qdrant = fakeQdrant({
      queryPoints: vi.fn<QdrantClient['queryPoints']>().mockRejectedValue(new Error('qdrant down')),
    });
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant,
      meili: fakeMeili(),
      rerank: scoreByTitleRerank(),
    });
    const hits = await findPotentialDuplicates(alice.id, '提交季度报告');
    expect(hits.map((hit) => hit.id)).toEqual([existing.id]);
  });

  it('does not leak another user\'s open tasks', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const bobInbox = await inboxId(app, bob.token);
    await createTask(bob.id, { title: '提交季度报告', listId: bobInbox });
    await expect(findPotentialDuplicates(alice.id, '提交季度报告')).resolves.toEqual([]);
  });
});

describe('create/convert routes attach similarOpenTasks', () => {
  it('POST /tasks includes similarOpenTasks for a matching open task', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '提交季度报告', listId: inbox },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().similarOpenTasks).toBeUndefined();

    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '提交季度报告 ', listId: inbox },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().id).not.toBe(first.json().id);
    expect(second.json().similarOpenTasks).toEqual([{ id: first.json().id, title: '提交季度报告' }]);
  });

  it('still creates the task when retrieval infra fails', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant({
        queryPoints: vi.fn<QdrantClient['queryPoints']>().mockRejectedValue(new Error('boom')),
      }),
      meili: fakeMeili(),
      rerank: {
        rerankTexts: vi.fn<RerankClient['rerankTexts']>().mockRejectedValue(new Error('rerank down')),
      },
    });
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '任何标题都行', listId: inbox },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().id).toBeTruthy();
  });

  it('POST /tasks/from-text includes similarOpenTasks', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '提交季度报告', listId: inbox },
    });
    expect(first.statusCode).toBe(201);

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks/from-text',
      token: alice.token,
      payload: { text: '提交季度报告', listId: inbox, timezone: 'Asia/Shanghai' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().title).toBe('提交季度报告');
    expect(created.json().similarOpenTasks).toEqual([
      { id: first.json().id, title: '提交季度报告' },
    ]);
  });

  it('inbox convert includes similarOpenTasks on the response and the task', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Turn into task', listId: inbox },
    });
    const item = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Turn into task', originalUrl: 'https://example.com/dup' },
    });
    const convert = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/inbox/${item.json().id}/convert`,
      token: alice.token,
      payload: {},
    });
    expect(convert.statusCode).toBe(201);
    expect(convert.json().similarOpenTasks).toEqual([
      { id: first.json().id, title: 'Turn into task' },
    ]);
    expect(convert.json().task.similarOpenTasks).toEqual(convert.json().similarOpenTasks);
  });

  it('createTask service does not attach similarOpenTasks', async () => {
    const alice = await registerUser(app, 'alice');
    const inbox = await inboxId(app, alice.token);
    await createTask(alice.id, { title: '提交季度报告', listId: inbox });
    const created = await createTask(alice.id, { title: '提交季度报告', listId: inbox });
    expect(created.similarOpenTasks).toBeUndefined();
  });
});

describe('agent/habit paths do not run duplicate detection', () => {
  it('keeps findPotentialDuplicates out of createTask, materialize, and habit spawn', () => {
    const createSrc = [
      'tasks/tasks.service.ts',
      'tasks/tasks.write.ts',
      'tasks/tasks.read.ts',
      'tasks/tasks.shared.ts',
    ]
      .map((rel) => readFileSync(join(srcRoot, rel), 'utf8'))
      .join('\n');
    const actionsSrc = readFileSync(join(srcRoot, 'agent/actions.service.ts'), 'utf8');
    const habitsSrc = readFileSync(join(srcRoot, 'habits/habits.service.ts'), 'utf8');
    expect(createSrc).not.toContain('findPotentialDuplicates');
    expect(createSrc).not.toContain('withSimilarOpenTasks');
    expect(actionsSrc).not.toContain('findPotentialDuplicates');
    expect(habitsSrc).not.toContain('findPotentialDuplicates');
  });
});
