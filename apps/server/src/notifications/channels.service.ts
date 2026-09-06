import { randomUUID } from 'node:crypto';
import {
  type CreateNotificationChannelInput,
  type NotificationChannel,
  type NotificationChannelCollection,
  type PatchNotificationChannelInput,
} from '@vital/dto';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { notificationChannels, type NotificationChannelRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { sendMeow } from './meow.js';

function toDto(row: NotificationChannelRow): NotificationChannel {
  return {
    id: row.id,
    type: 'meow',
    enabled: row.enabled,
    config: { nickname: row.config.nickname },
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function owned(userId: string, id: string): Promise<NotificationChannelRow> {
  const [row] = await getDb()
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'CHANNEL_NOT_FOUND');
  return row;
}

export async function listChannels(userId: string): Promise<NotificationChannelCollection> {
  const rows = await getDb()
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.userId, userId))
    .orderBy(asc(notificationChannels.createdAt));
  return { items: rows.map(toDto) };
}

export async function createChannel(
  userId: string,
  input: CreateNotificationChannelInput,
): Promise<NotificationChannel> {
  const now = new Date();
  const row = {
    id: randomUUID(),
    userId,
    type: input.type,
    enabled: input.enabled ?? true,
    config: { nickname: input.config.nickname },
    lastSuccessAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await getDb().insert(notificationChannels).values(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.of(409, 'CHANNEL_EXISTS');
    throw err;
  }
  return toDto(row);
}

export async function patchChannel(
  userId: string,
  id: string,
  input: PatchNotificationChannelInput,
): Promise<NotificationChannel> {
  const row = await owned(userId, id);
  const now = new Date();
  const next = {
    enabled: input.enabled ?? row.enabled,
    config: input.config ?? row.config,
    updatedAt: now,
  };
  await getDb().update(notificationChannels).set(next).where(eq(notificationChannels.id, row.id));
  return toDto({ ...row, ...next });
}

export async function deleteChannel(userId: string, id: string): Promise<void> {
  const row = await owned(userId, id);
  await getDb()
    .delete(notificationChannels)
    .where(and(eq(notificationChannels.id, row.id), eq(notificationChannels.userId, userId)));
}

export async function testChannel(userId: string, id: string): Promise<void> {
  const row = await owned(userId, id);
  const result = await sendMeow({
    nickname: row.config.nickname,
    title: 'Vital 测试',
    msg: '通知渠道已接通',
  });
  const now = new Date();
  if (!result.ok) {
    await getDb()
      .update(notificationChannels)
      .set({ lastError: result.error.slice(0, 500), updatedAt: now })
      .where(eq(notificationChannels.id, row.id));
    throw AppError.of(400, 'CHANNEL_DELIVERY_FAILED', { message: result.error });
  }
  await getDb()
    .update(notificationChannels)
    .set({ lastSuccessAt: now, lastError: null, updatedAt: now })
    .where(eq(notificationChannels.id, row.id));
}
