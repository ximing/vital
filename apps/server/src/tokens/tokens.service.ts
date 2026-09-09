import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  API_TOKEN_ACCESS_RETENTION_DAYS,
  API_TOKEN_MAX_PER_USER,
  API_TOKEN_PREFIX,
  API_TOKEN_PREFIX_LENGTH,
  isApiTokenSecret,
  type ApiToken,
  type ApiTokenAccessCollection,
  type ApiTokenAccessLog,
  type ApiTokenCollection,
  type CreateApiTokenInput,
  type CreatedApiToken,
  type ListApiTokenAccessQuery,
} from '@vital/dto';
import { and, count, desc, eq, gte, isNull, lt, or, type SQL } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { apiTokenAccessLogs, apiTokens, type ApiTokenRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';

const LAST_USED_MIN_INTERVAL_MS = 60_000;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function dtoOf(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function accessDtoOf(row: typeof apiTokenAccessLogs.$inferSelect): ApiTokenAccessLog {
  return {
    id: String(row.id),
    method: row.method,
    path: row.path,
    status: row.status,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

async function getOwnedActiveToken(userId: string, id: string): Promise<ApiTokenRow> {
  const [row] = await getDb()
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

export async function listApiTokens(userId: string): Promise<ApiTokenCollection> {
  const rows = await getDb()
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return { items: rows.map(dtoOf) };
}

export async function createApiToken(
  userId: string,
  input: CreateApiTokenInput,
): Promise<CreatedApiToken> {
  const [countRow] = await getDb()
    .select({ n: count() })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
  if ((countRow?.n ?? 0) >= API_TOKEN_MAX_PER_USER) {
    throw AppError.of(400, 'TOKEN_LIMIT_REACHED');
  }

  const raw = `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const now = new Date();
  const row: ApiTokenRow = {
    id: randomUUID(),
    userId,
    name: input.name,
    tokenPrefix: raw.slice(0, API_TOKEN_PREFIX_LENGTH),
    tokenHash: sha256(raw),
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now,
  };
  await getDb().insert(apiTokens).values(row);
  return { ...dtoOf(row), token: raw };
}

export async function revokeApiToken(userId: string, id: string): Promise<void> {
  await getOwnedActiveToken(userId, id);
  await getDb()
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
}

export async function listApiTokenAccess(
  userId: string,
  tokenId: string,
  query: ListApiTokenAccessQuery,
): Promise<ApiTokenAccessCollection> {
  await getOwnedActiveToken(userId, tokenId);
  const limit = query.limit;
  const cutoff = new Date(Date.now() - API_TOKEN_ACCESS_RETENTION_DAYS * 86_400_000);
  const filters: SQL[] = [
    eq(apiTokenAccessLogs.tokenId, tokenId),
    eq(apiTokenAccessLogs.userId, userId),
    gte(apiTokenAccessLogs.createdAt, cutoff),
  ];
  let where: SQL = and(...filters) as SQL;
  if (query.cursor !== undefined) {
    const cur = decodeCursor(query.cursor);
    const t = new Date(cur.t);
    const cursorId = Number(cur.id);
    if (!Number.isSafeInteger(cursorId)) throw AppError.of(400, 'VALIDATION_ERROR');
    where = and(
      where,
      or(
        lt(apiTokenAccessLogs.createdAt, t),
        and(eq(apiTokenAccessLogs.createdAt, t), lt(apiTokenAccessLogs.id, cursorId)),
      ),
    ) as SQL;
  }
  const rows = await getDb()
    .select()
    .from(apiTokenAccessLogs)
    .where(where)
    .orderBy(desc(apiTokenAccessLogs.createdAt), desc(apiTokenAccessLogs.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = page[page.length - 1];
    if (last) nextCursor = encodeCursor(last.createdAt.toISOString(), String(last.id));
  }
  return { items: page.map(accessDtoOf), nextCursor };
}

export async function resolveApiToken(raw: string): Promise<{ id: string; userId: string } | null> {
  if (!isApiTokenSecret(raw)) return null;
  const [row] = await getDb()
    .select({ id: apiTokens.id, userId: apiTokens.userId })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, sha256(raw)), isNull(apiTokens.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function recordApiTokenAccess(input: {
  tokenId: string;
  userId: string;
  method: string;
  path: string;
  status: number;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const now = new Date();
  const path = input.path.slice(0, 512);
  const method = input.method.slice(0, 8);
  await getDb().insert(apiTokenAccessLogs).values({
    tokenId: input.tokenId,
    userId: input.userId,
    method,
    path,
    status: input.status,
    ip: input.ip,
    userAgent: input.userAgent,
    createdAt: now,
  });
  const staleBefore = new Date(now.getTime() - LAST_USED_MIN_INTERVAL_MS);
  await getDb()
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiTokens.id, input.tokenId),
        or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, staleBefore)),
      ),
    );
}

export async function purgeExpiredApiTokenAccess(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - API_TOKEN_ACCESS_RETENTION_DAYS * 86_400_000);
  const deleted = await getDb()
    .delete(apiTokenAccessLogs)
    .where(lt(apiTokenAccessLogs.createdAt, cutoff))
    .returning({ id: apiTokenAccessLogs.id });
  if (deleted.length > 0) {
    logger.info('api_token.access.purged', { count: deleted.length });
  }
  return deleted.length;
}

export function startApiTokenAccessSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void purgeExpiredApiTokenAccess().catch((err: unknown) => {
      logger.error('api_token.access.sweeper.failed', err);
    });
  }, config.SWEEPER_INTERVAL_MS);
  timer.unref();
  logger.info('api token access sweeper started', { intervalMs: config.SWEEPER_INTERVAL_MS });
  return timer;
}
