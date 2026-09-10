import { ensure2xx, requestJson } from './http.js';

export interface MeiliClientOptions {
  url: string;
  apiKey: string;
  timeoutMs?: number;
  /** Prepended to every index uid (e.g. `dev_` → `dev_tasks`). */
  namePrefix?: string | undefined;
}

/** Meili filter expression: a string, or an array AND-ed of strings / OR-ed string lists. */
export type MeiliFilter = string | Array<string | string[]>;

export interface MeiliSearchQuery {
  indexUid: string;
  q: string;
  filter?: MeiliFilter;
  limit?: number;
}

export interface MeiliListDocumentsParams {
  filter?: MeiliFilter;
  fields?: string[];
  limit?: number;
  offset?: number;
}

export interface MeiliDocumentsPage {
  results: Record<string, unknown>[];
  total: number;
}

export interface MeiliClient {
  ensureIndex(uid: string): Promise<void>;
  upsertDocuments(uid: string, docs: Record<string, unknown>[]): Promise<void>;
  deleteDocuments(uid: string, ids: (string | number)[]): Promise<void>;
  /** Browse documents (id listing for index.sync reconciliation). */
  listDocuments(uid: string, params: MeiliListDocumentsParams): Promise<MeiliDocumentsPage>;
  search(
    uid: string,
    query: { q: string; filter?: MeiliFilter; limit?: number },
  ): Promise<Record<string, unknown>[]>;
  multiSearch(queries: MeiliSearchQuery[]): Promise<Record<string, Record<string, unknown>[]>>;
}

/** Every index filters on these; cmn gives Chinese segmentation. */
const INDEX_SETTINGS = {
  filterableAttributes: ['userId', 'type', 'status', 'scope'],
  localizedAttributes: [{ attributePatterns: ['*'], locales: ['cmn'] }],
} as const;

function asHits(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).map((item) =>
    typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {},
  );
}

/** Thin Meilisearch REST wrapper. Writes are accepted (202) asynchronously by Meili. */
export function createMeiliClient(options: MeiliClientOptions): MeiliClient {
  const base = options.url.replace(/\/$/, '');
  const prefix = options.namePrefix ?? '';

  function qualify(uid: string): string {
    return `${prefix}${uid}`;
  }

  function headers(): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` };
  }

  function call(method: string, path: string, body?: unknown) {
    return requestJson(method, `${base}${path}`, {
      timeoutMs: options.timeoutMs,
      headers: headers(),
      body,
    });
  }

  return {
    async ensureIndex(uid) {
      const index = qualify(uid);
      const existing = await call('GET', `/indexes/${index}`);
      if (existing.status === 404) {
        ensure2xx(
          await call('POST', '/indexes', { uid: index, primaryKey: 'id' }),
          'meili create index',
        );
      } else {
        ensure2xx(existing, 'meili get index');
        // Indexes created before primaryKey was set explicitly have primaryKey: null;
        // Meili's primary-key inference then fails on docs with multiple *id fields.
        const primaryKey = (existing.json as { primaryKey?: unknown }).primaryKey;
        if (primaryKey === null || primaryKey === undefined) {
          ensure2xx(
            await call('PATCH', `/indexes/${index}`, { primaryKey: 'id' }),
            'meili set primary key',
          );
        }
      }
      ensure2xx(
        await call('PATCH', `/indexes/${index}/settings`, INDEX_SETTINGS),
        'meili settings',
      );
    },

    async upsertDocuments(uid, docs) {
      if (docs.length === 0) return;
      // ?primaryKey=id is a no-op once the index has a primary key, but saves
      // freshly created indexes from Meili's ambiguous primary-key inference.
      ensure2xx(
        await call('POST', `/indexes/${qualify(uid)}/documents?primaryKey=id`, docs),
        'meili upsert documents',
      );
    },

    async deleteDocuments(uid, ids) {
      if (ids.length === 0) return;
      ensure2xx(
        await call('POST', `/indexes/${qualify(uid)}/documents/delete-batch`, ids),
        'meili delete documents',
      );
    },

    async listDocuments(uid, params) {
      const res = await call('POST', `/indexes/${qualify(uid)}/documents/fetch`, {
        filter: params.filter,
        fields: params.fields,
        limit: params.limit,
        offset: params.offset,
      });
      ensure2xx(res, 'meili list documents');
      const body = res.json as { results?: unknown; total?: unknown };
      return {
        results: asHits(body.results),
        total: typeof body.total === 'number' ? body.total : 0,
      };
    },

    async search(uid, query) {
      const res = await call('POST', `/indexes/${qualify(uid)}/search`, {
        q: query.q,
        filter: query.filter,
        limit: query.limit,
      });
      ensure2xx(res, 'meili search');
      return asHits((res.json as { hits?: unknown }).hits);
    },

    async multiSearch(queries) {
      const logicalByPrefixed = new Map(queries.map((q) => [qualify(q.indexUid), q.indexUid]));
      const res = await call('POST', '/multi-search', {
        queries: queries.map((q) => ({
          indexUid: qualify(q.indexUid),
          q: q.q,
          filter: q.filter,
          limit: q.limit,
        })),
      });
      ensure2xx(res, 'meili multi-search');
      const results = (res.json as { results?: unknown }).results;
      const grouped: Record<string, Record<string, unknown>[]> = {};
      if (!Array.isArray(results)) return grouped;
      for (const item of results as unknown[]) {
        const record = item as { indexUid?: unknown; hits?: unknown };
        if (typeof record.indexUid !== 'string') continue;
        const logical = logicalByPrefixed.get(record.indexUid) ?? record.indexUid;
        grouped[logical] = asHits(record.hits);
      }
      return grouped;
    },
  };
}
