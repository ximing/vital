import { ensure2xx, requestJson } from './http.js';

export interface QdrantClientOptions {
  url: string;
  apiKey?: string | undefined;
  vectorSize: number;
  timeoutMs?: number;
  /** Prepended to every collection name (e.g. `dev_` → `dev_tasks`). */
  namePrefix?: string | undefined;
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface QdrantScoredPoint {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
}

export interface QdrantStoredPoint {
  id: string | number;
  payload: Record<string, unknown>;
  vector?: number[];
}

export interface QdrantClient {
  ensureCollection(name: string): Promise<void>;
  upsertPoints(name: string, points: QdrantPoint[]): Promise<void>;
  /** filter is caller-built native Qdrant JSON ({must: [...]}), or undefined for none. */
  queryPoints(
    name: string,
    vector: number[],
    filter: unknown,
    limit: number,
  ): Promise<QdrantScoredPoint[]>;
  deletePoints(name: string, ids: (string | number)[]): Promise<void>;
  scrollPoints(
    name: string,
    filter: unknown,
    opts?: { withVector?: boolean },
  ): Promise<QdrantStoredPoint[]>;
}

/** Payload fields every collection filters on; keyword indexes keep filtering cheap. */
const PAYLOAD_INDEX_FIELDS = ['userId', 'scope', 'status'] as const;
const SCROLL_PAGE_SIZE = 256;

function asPayload(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Thin Qdrant REST wrapper. Ids/payloads pass through untouched. */
export function createQdrantClient(options: QdrantClientOptions): QdrantClient {
  const base = options.url.replace(/\/$/, '');
  const prefix = options.namePrefix ?? '';

  function qualify(name: string): string {
    return `${prefix}${name}`;
  }

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (options.apiKey) h['api-key'] = options.apiKey;
    return h;
  }

  function call(method: string, path: string, body?: unknown) {
    return requestJson(method, `${base}${path}`, {
      timeoutMs: options.timeoutMs,
      headers: headers(),
      body,
    });
  }

  return {
    async ensureCollection(name) {
      const collection = qualify(name);
      const existing = await call('GET', `/collections/${collection}`);
      if (existing.status === 404) {
        ensure2xx(
          await call('PUT', `/collections/${collection}`, {
            vectors: { size: options.vectorSize, distance: 'Cosine' },
          }),
          'qdrant create collection',
        );
      } else {
        ensure2xx(existing, 'qdrant get collection');
      }
      for (const field of PAYLOAD_INDEX_FIELDS) {
        ensure2xx(
          await call('PUT', `/collections/${collection}/index`, {
            field_name: field,
            field_schema: 'keyword',
          }),
          'qdrant create payload index',
        );
      }
    },

    async upsertPoints(name, points) {
      if (points.length === 0) return;
      ensure2xx(
        await call('PUT', `/collections/${qualify(name)}/points?wait=true`, { points }),
        'qdrant upsert points',
      );
    },

    async queryPoints(name, vector, filter, limit) {
      const res = await call('POST', `/collections/${qualify(name)}/points/query`, {
        query: vector,
        filter,
        limit,
        with_payload: true,
      });
      ensure2xx(res, 'qdrant query points');
      const result = (res.json as { result?: { points?: unknown } }).result;
      const rows = Array.isArray(result?.points) ? (result.points as unknown[]) : [];
      return rows.map((item) => {
        const record = item as { id?: unknown; score?: unknown; payload?: unknown };
        return {
          id: typeof record.id === 'number' ? record.id : String(record.id),
          score: typeof record.score === 'number' ? record.score : 0,
          payload: asPayload(record.payload),
        };
      });
    },

    async deletePoints(name, ids) {
      if (ids.length === 0) return;
      ensure2xx(
        await call('POST', `/collections/${qualify(name)}/points/delete?wait=true`, {
          points: ids,
        }),
        'qdrant delete points',
      );
    },

    async scrollPoints(name, filter, opts) {
      const collected: QdrantStoredPoint[] = [];
      let offset: unknown;
      for (;;) {
        const body: Record<string, unknown> = {
          limit: SCROLL_PAGE_SIZE,
          with_payload: true,
          with_vector: opts?.withVector ?? false,
          filter,
        };
        if (offset !== undefined) body.offset = offset;
        const res = await call('POST', `/collections/${qualify(name)}/points/scroll`, body);
        ensure2xx(res, 'qdrant scroll points');
        const result = (res.json as {
          result?: { points?: unknown; next_page_offset?: unknown };
        }).result;
        const rows = Array.isArray(result?.points) ? (result.points as unknown[]) : [];
        for (const item of rows) {
          const record = item as { id?: unknown; payload?: unknown; vector?: unknown };
          const point: QdrantStoredPoint = {
            id: typeof record.id === 'number' ? record.id : String(record.id),
            payload: asPayload(record.payload),
          };
          if (Array.isArray(record.vector)) {
            point.vector = (record.vector as unknown[]).filter(
              (v): v is number => typeof v === 'number',
            );
          }
          collected.push(point);
        }
        const next = result?.next_page_offset;
        if (next === null || next === undefined) return collected;
        offset = next;
      }
    },
  };
}
