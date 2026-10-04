import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthMode, AuthResponse, QrLoginDecision, QrLoginTicket, QrLoginTicketInput } from '@vital/dto';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { qrLoginTickets, type QrLoginTicketRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { getUserEntity, toProfile } from './auth.service.js';
import { issueRefreshToken, signAccessToken } from './token.service.js';

const QR_LOGIN_TTL_MS = 120_000;
const QR_LOGIN_KEEP_MS = 86_400_000;

export type QrLoginPollResult =
  | { status: 'pending' | 'scanned' | 'expired' | 'cancelled' }
  | { status: 'confirmed'; response: AuthResponse; refreshToken: string };

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hashesEqual(stored: string, next: string): boolean {
  const left = Buffer.from(stored.trim());
  const right = Buffer.from(next);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function tokensFor(accessToken: string, refreshToken: string, mode: AuthMode): AuthResponse['tokens'] {
  if (mode === 'cookie') return { accessToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
  return { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
}

function isExpired(row: QrLoginTicketRow, now: Date): boolean {
  return row.expiresAt.getTime() <= now.getTime();
}

async function requireTicket(id: string, secret: string): Promise<QrLoginTicketRow> {
  const [row] = await getDb()
    .select()
    .from(qrLoginTickets)
    .where(eq(qrLoginTickets.id, id))
    .limit(1);
  if (!row || !hashesEqual(row.secretHash, sha256(secret))) {
    throw AppError.of(400, 'QR_LOGIN_INVALID');
  }
  return row;
}

export async function createQrLogin(): Promise<QrLoginTicket> {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QR_LOGIN_TTL_MS);
  await getDb().transaction(async (tx) => {
    await tx
      .delete(qrLoginTickets)
      .where(lt(qrLoginTickets.expiresAt, new Date(now.getTime() - QR_LOGIN_KEEP_MS)));
    await tx.insert(qrLoginTickets).values({
      id,
      secretHash: sha256(secret),
      status: 'pending',
      userId: null,
      expiresAt,
      createdAt: now,
    });
  });
  return { id, secret, expiresAt: expiresAt.toISOString() };
}

export async function scanQrLogin(input: QrLoginTicketInput): Promise<QrLoginDecision> {
  const now = new Date();
  const row = await requireTicket(input.id, input.secret);
  if (isExpired(row, now) || row.status === 'consumed' || row.status === 'cancelled') {
    throw AppError.of(400, 'QR_LOGIN_INVALID');
  }
  if (row.status === 'confirmed') return { status: 'confirmed' };
  if (row.status === 'scanned') return { status: 'scanned' };
  const updated = await getDb()
    .update(qrLoginTickets)
    .set({ status: 'scanned' })
    .where(
      and(
        eq(qrLoginTickets.id, row.id),
        eq(qrLoginTickets.status, 'pending'),
        gt(qrLoginTickets.expiresAt, now),
      ),
    )
    .returning({ id: qrLoginTickets.id });
  if (updated[0]) return { status: 'scanned' };
  const again = await requireTicket(input.id, input.secret);
  if (again.status === 'scanned') return { status: 'scanned' };
  if (again.status === 'confirmed') return { status: 'confirmed' };
  throw AppError.of(400, 'QR_LOGIN_INVALID');
}

export async function confirmQrLogin(
  userId: string,
  input: QrLoginTicketInput,
): Promise<QrLoginDecision> {
  await getUserEntity(userId);
  const now = new Date();
  const row = await requireTicket(input.id, input.secret);
  if (isExpired(row, now) || row.status === 'consumed' || row.status === 'cancelled') {
    throw AppError.of(400, 'QR_LOGIN_INVALID');
  }
  if (row.status === 'confirmed') {
    if (row.userId === userId) return { status: 'confirmed' };
    throw AppError.of(400, 'QR_LOGIN_INVALID');
  }
  const updated = await getDb()
    .update(qrLoginTickets)
    .set({ status: 'confirmed', userId })
    .where(
      and(
        eq(qrLoginTickets.id, row.id),
        eq(qrLoginTickets.status, 'scanned'),
        gt(qrLoginTickets.expiresAt, now),
      ),
    )
    .returning({ id: qrLoginTickets.id });
  if (!updated[0]) throw AppError.of(400, 'QR_LOGIN_INVALID');
  logger.info('auth.qr.confirm', { userId, ticketId: row.id });
  return { status: 'confirmed' };
}

export async function cancelQrLogin(input: QrLoginTicketInput): Promise<QrLoginDecision> {
  const now = new Date();
  const row = await requireTicket(input.id, input.secret);
  if (row.status === 'cancelled') return { status: 'cancelled' };
  if (isExpired(row, now) || row.status === 'consumed' || row.status === 'confirmed') {
    throw AppError.of(400, 'QR_LOGIN_INVALID');
  }
  const updated = await getDb()
    .update(qrLoginTickets)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(qrLoginTickets.id, row.id),
        inArray(qrLoginTickets.status, ['pending', 'scanned']),
        gt(qrLoginTickets.expiresAt, now),
      ),
    )
    .returning({ id: qrLoginTickets.id });
  if (!updated[0]) throw AppError.of(400, 'QR_LOGIN_INVALID');
  return { status: 'cancelled' };
}

export async function pollQrLogin(
  input: QrLoginTicketInput,
  mode: AuthMode,
  deviceInfo?: string,
): Promise<QrLoginPollResult> {
  const now = new Date();
  const row = await requireTicket(input.id, input.secret);
  if (isExpired(row, now) || row.status === 'consumed') return { status: 'expired' };
  if (row.status === 'cancelled') return { status: 'cancelled' };
  if (row.status === 'pending' || row.status === 'scanned') return { status: row.status };
  if (row.userId === null) throw AppError.of(400, 'QR_LOGIN_INVALID');
  const user = await getUserEntity(row.userId);
  const profile = await toProfile(user);
  const refreshToken = await getDb().transaction(async (tx) => {
    const claimed = await tx
      .update(qrLoginTickets)
      .set({ status: 'consumed' })
      .where(
        and(
          eq(qrLoginTickets.id, row.id),
          eq(qrLoginTickets.status, 'confirmed'),
          gt(qrLoginTickets.expiresAt, now),
        ),
      )
      .returning({ userId: qrLoginTickets.userId });
    const claimedRow = claimed[0];
    if (!claimedRow?.userId) return null;
    return issueRefreshToken(claimedRow.userId, mode, deviceInfo, tx);
  });
  if (refreshToken === null) return { status: 'expired' };
  logger.info('auth.qr.login', { userId: user.id, ticketId: row.id });
  return {
    status: 'confirmed',
    response: { user: profile, tokens: tokensFor(signAccessToken(user.id), refreshToken, mode) },
    refreshToken,
  };
}
