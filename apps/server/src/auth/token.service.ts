import { createHash, randomBytes } from 'node:crypto';
import type { AuthMode } from '@vital/dto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb, type Database } from '../db/index.js';
import { refreshTokens } from '../db/schema.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';

const ACCESS_TYPE = 'access';

type TokenStore = Pick<Database, 'insert' | 'update' | 'select'>;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, type: ACCESS_TYPE }, config.JWT_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): { userId: string; iat: number } {
  try {
    const payload: unknown = jwt.verify(token, config.JWT_SECRET);
    if (typeof payload !== 'object' || payload === null) throw new Error('bad payload');
    const claims: Record<string, unknown> = { ...payload };
    const typeValue = claims['type'];
    const sub = claims['sub'];
    const iat = claims['iat'];
    if (typeValue !== ACCESS_TYPE || typeof sub !== 'string' || typeof iat !== 'number') {
      throw new Error('bad payload');
    }
    return { userId: sub, iat };
  } catch {
    throw AppError.of(401, 'INVALID_TOKEN');
  }
}

export async function issueRefreshToken(
  userId: string,
  authMode: AuthMode,
  deviceInfo?: string,
  store: TokenStore = getDb(),
): Promise<string> {
  const raw = randomBytes(48).toString('base64url');
  await store.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(raw),
    authMode,
    deviceInfo: deviceInfo ?? null,
    expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  return raw;
}

export async function rotateRefreshToken(
  raw: string,
  expectedMode: AuthMode,
): Promise<{ userId: string; refreshToken: string }> {
  const hash = sha256(raw);
  const now = new Date();
  const outcome = await getDb().transaction(async (tx) => {
    const claimed = await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.tokenHash, hash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
          eq(refreshTokens.authMode, expectedMode),
        ),
      )
      .returning({
        userId: refreshTokens.userId,
        deviceInfo: refreshTokens.deviceInfo,
      });
    const claimedRow = claimed[0];
    if (claimedRow) {
      const refreshToken = await issueRefreshToken(
        claimedRow.userId,
        expectedMode,
        claimedRow.deviceInfo ?? undefined,
        tx,
      );
      return { ok: true as const, userId: claimedRow.userId, refreshToken };
    }

    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);
    if (row?.revokedAt) {
      logger.warn('auth.refresh.reuse', { userId: row.userId });
      await revokeAllForUser(row.userId, tx);
    }
    return { ok: false as const };
  });
  // Throw after commit so reuse revoke-all is not rolled back with AppError.
  if (!outcome.ok) throw AppError.of(401, 'INVALID_TOKEN');
  return { userId: outcome.userId, refreshToken: outcome.refreshToken };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256(raw)), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(userId: string, store: TokenStore = getDb()): Promise<void> {
  await store
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
