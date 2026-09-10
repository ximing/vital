/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions */
/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked on fake client methods */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type MeiliClient,
} from '../../src/retrieval/registry.js';
import {
  INBOX_INDEX,
  OUTCOMES_INDEX,
  indexInboxItem,
  indexOutcome,
  removeInboxItemIndex,
  removeOutcomeIndex,
  searchAll,
} from '../../src/retrieval/search.js';
import { TASKS_INDEX } from '../../src/retrieval/tasks.js';

function fakeMeili(overrides: Partial<MeiliClient> = {}): MeiliClient {
  return {
    ensureIndex: vi.fn<MeiliClient['ensureIndex']>().mockResolvedValue(undefined),
    upsertDocuments: vi.fn<MeiliClient['upsertDocuments']>().mockResolvedValue(undefined),
    deleteDocuments: vi.fn<MeiliClient['deleteDocuments']>().mockResolvedValue(undefined),
    listDocuments: vi.fn<MeiliClient['listDocuments']>().mockResolvedValue({ results: [], total: 0 }),
    search: vi.fn<MeiliClient['search']>().mockResolvedValue([]),
    multiSearch: vi.fn<MeiliClient['multiSearch']>().mockResolvedValue({}),
    ...overrides,
  };
}

beforeEach(() => {
  resetRetrievalClientsForTest();
});

afterEach(() => {
  resetRetrievalClientsForTest();
});

describe('indexOutcome / removeOutcomeIndex', () => {
  it('upserts a slim outcome document into the outcomes index', async () => {
    const meili = fakeMeili();
    setRetrievalClientsForTest({ meili });

    await indexOutcome({ id: 'o1', userId: 'u1', name: '换工作', status: 'open' });

    expect(meili.upsertDocuments).toHaveBeenCalledWith(OUTCOMES_INDEX, [
      { id: 'o1', userId: 'u1', type: 'outcome', name: '换工作', status: 'open' },
    ]);
  });

  it('deletes the document by id', async () => {
    const meili = fakeMeili();
    setRetrievalClientsForTest({ meili });

    await removeOutcomeIndex('o1');
    expect(meili.deleteDocuments).toHaveBeenCalledWith(OUTCOMES_INDEX, ['o1']);
  });

  it('is a no-op when meili is not configured', async () => {
    setRetrievalClientsForTest({ meili: null });
    await expect(
      indexOutcome({ id: 'o1', userId: 'u1', name: 'x', status: 'open' }),
    ).resolves.toBeUndefined();
    await expect(removeOutcomeIndex('o1')).resolves.toBeUndefined();
  });
});

describe('indexInboxItem / removeInboxItemIndex', () => {
  it('upserts a slim inbox document into the inbox index', async () => {
    const meili = fakeMeili();
    setRetrievalClientsForTest({ meili });

    await indexInboxItem({
      id: 'i1',
      userId: 'u1',
      title: '一篇文章',
      excerpt: '摘要',
      status: 'unread',
    });

    expect(meili.upsertDocuments).toHaveBeenCalledWith(INBOX_INDEX, [
      { id: 'i1', userId: 'u1', type: 'inbox', title: '一篇文章', excerpt: '摘要', status: 'unread' },
    ]);
  });

  it('deletes the document by id', async () => {
    const meili = fakeMeili();
    setRetrievalClientsForTest({ meili });

    await removeInboxItemIndex('i1');
    expect(meili.deleteDocuments).toHaveBeenCalledWith(INBOX_INDEX, ['i1']);
  });

  it('is a no-op when meili is not configured', async () => {
    setRetrievalClientsForTest({ meili: null });
    await expect(
      indexInboxItem({ id: 'i1', userId: 'u1', title: 'x', excerpt: null, status: 'unread' }),
    ).resolves.toBeUndefined();
    await expect(removeInboxItemIndex('i1')).resolves.toBeUndefined();
  });
});

describe('searchAll', () => {
  it('returns null when meili is not configured', async () => {
    setRetrievalClientsForTest({ meili: null });
    await expect(searchAll({ userId: 'u1', q: '牛奶' })).resolves.toBeNull();
  });

  it('multi-searches the three indexes with a user filter and maps slim groups', async () => {
    const meili = fakeMeili({
      multiSearch: vi.fn<MeiliClient['multiSearch']>().mockResolvedValue({
        [TASKS_INDEX]: [
          { id: 't1', title: '买牛奶', status: 'todo', listId: 'l1', extra: 'ignored' },
          { id: 't2' }, // missing title → dropped
        ],
        [OUTCOMES_INDEX]: [{ id: 'o1', name: '健康饮食', status: 'open' }],
        [INBOX_INDEX]: [{ id: 'i1', title: '牛奶测评', excerpt: '乳品…', status: 'unread' }],
      }),
    });
    setRetrievalClientsForTest({ meili });

    const results = await searchAll({ userId: 'u1', q: '牛奶' });

    // Settings ensured once before searching (filterable userId etc.).
    expect(meili.ensureIndex).toHaveBeenCalledWith(TASKS_INDEX);
    expect(meili.ensureIndex).toHaveBeenCalledWith(OUTCOMES_INDEX);
    expect(meili.ensureIndex).toHaveBeenCalledWith(INBOX_INDEX);

    const queries = vi.mocked(meili.multiSearch).mock.calls[0]![0];
    expect(queries).toHaveLength(3);
    expect(queries.map((q) => q.indexUid)).toEqual([TASKS_INDEX, OUTCOMES_INDEX, INBOX_INDEX]);
    for (const query of queries) {
      expect(query.q).toBe('牛奶');
      expect(query.filter).toBe("userId = 'u1'");
      expect(query.limit).toBe(5);
    }

    expect(results).toEqual({
      tasks: [{ id: 't1', listId: 'l1', title: '买牛奶', status: 'todo' }],
      outcomes: [{ id: 'o1', name: '健康饮食', status: 'open' }],
      inbox: [{ id: 'i1', title: '牛奶测评', excerpt: '乳品…' }],
    });
  });

  it('respects a custom limit and escapes quotes in the user filter', async () => {
    const meili = fakeMeili();
    setRetrievalClientsForTest({ meili });

    await searchAll({ userId: "u'1", q: 'x', limit: 12 });

    const queries = vi.mocked(meili.multiSearch).mock.calls[0]![0];
    expect(queries[0]!.filter).toBe("userId = 'u\\'1'");
    expect(queries[0]!.limit).toBe(12);
  });

  it('returns empty groups when an index is missing from the multi-search response', async () => {
    const meili = fakeMeili({
      multiSearch: vi.fn<MeiliClient['multiSearch']>().mockResolvedValue({
        [OUTCOMES_INDEX]: [{ id: 'o1', name: '线程', status: 'open' }],
      }),
    });
    setRetrievalClientsForTest({ meili });

    const results = await searchAll({ userId: 'u1', q: 'x' });
    expect(results).toEqual({
      tasks: [],
      outcomes: [{ id: 'o1', name: '线程', status: 'open' }],
      inbox: [],
    });
  });

  it('propagates meili failures to the caller', async () => {
    const meili = fakeMeili({
      multiSearch: vi.fn<MeiliClient['multiSearch']>().mockRejectedValue(new Error('meili down')),
    });
    setRetrievalClientsForTest({ meili });

    await expect(searchAll({ userId: 'u1', q: 'x' })).rejects.toThrow('meili down');
  });
});
