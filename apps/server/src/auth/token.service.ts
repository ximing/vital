import { createHash, randomBytes } from 'node:crypto';
import type { AuthMode } from '@vital/dto';
import { and, eq, isNull } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { refreshTokens } from '../db/schema.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';

const ACCESS_TYPE = 'access';

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
): Promise<string> {
  const raw = randomBytes(48).toString('base64url');
  await getDb()
    .insert(refreshTokens)
    .values({
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
  const [row] = await getDb()
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(raw)))
    .limit(1);

  if (!row) throw AppError.of(401, 'INVALID_TOKEN');
  if (row.revokedAt) {
    logger.warn('auth.refresh.reuse', { userId: row.userId });
    await revokeAllForUser(row.userId);
    throw AppError.of(401, 'INVALID_TOKEN');
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw AppError.of(401, 'INVALID_TOKEN');
  }
  if (row.authMode !== expectedMode) {
    throw AppError.of(401, 'INVALID_TOKEN');
  }

  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, row.id));
  const refreshToken = await issueRefreshToken(
    row.userId,
    expectedMode,
    row.deviceInfo ?? undefined,
  );
  return { userId: row.userId, refreshToken };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256(raw)), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
