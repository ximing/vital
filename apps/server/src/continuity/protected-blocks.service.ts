import { randomUUID } from 'node:crypto';
import type {
  ContinuityProtectedBlock,
  ContinuityProtectedBlockKind,
  ContinuityProtectedBlockList,
  CreateContinuityProtectedBlockInput,
  PatchContinuityProtectedBlockInput,
} from '@vital/dto';
import { and, eq } from 'drizzle-orm';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import { continuityProtectedBlocks, type ContinuityProtectedBlockRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueUserContinuityRecomputes } from './enqueue.js';

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toDto(row: ContinuityProtectedBlockRow): ContinuityProtectedBlock {
  return {
    id: row.id,
    kind: row.kind as ContinuityProtectedBlockKind,
    label: row.label,
    timezone: row.timezone,
    startAt: iso(row.startAt),
    endAt: iso(row.endAt),
    weekday: row.weekday,
    startHm: row.startHm,
    endHm: row.endHm,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadOwned(userId: string, id: string): Promise<ContinuityProtectedBlockRow> {
  const [row] = await getDb()
    .select()
    .from(continuityProtectedBlocks)
    .where(and(eq(continuityProtectedBlocks.id, id), eq(continuityProtectedBlocks.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

function parseInstant(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw AppError.of(400, 'VALIDATION_ERROR');
  return date;
}

export async function listContinuityProtectedBlocks(userId: string): Promise<ContinuityProtectedBlockList> {
  const rows = await getDb()
    .select()
    .from(continuityProtectedBlocks)
    .where(eq(continuityProtectedBlocks.userId, userId));
  return { items: rows.map(toDto) };
}

export async function createContinuityProtectedBlock(
  userId: string,
  input: CreateContinuityProtectedBlockInput,
): Promise<ContinuityProtectedBlock> {
  const user = await getUserEntity(userId);
  const timezone = input.timezone ?? user.timezone;
  const now = new Date();
  const values =
    input.kind === 'once'
      ? (() => {
          const startAt = parseInstant(input.startAt);
          const endAt = parseInstant(input.endAt);
          if (endAt.getTime() <= startAt.getTime()) throw AppError.of(400, 'VALIDATION_ERROR');
          return {
            kind: 'once' as const,
            startAt,
            endAt,
            weekday: null,
            startHm: null,
            endHm: null,
          };
        })()
      : (() => {
          if (input.endHm <= input.startHm) throw AppError.of(400, 'VALIDATION_ERROR');
          return {
            kind: 'weekly' as const,
            startAt: null,
            endAt: null,
            weekday: input.weekday,
            startHm: input.startHm,
            endHm: input.endHm,
          };
        })();
  return getDb().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(continuityProtectedBlocks)
      .values({
        id: randomUUID(),
        userId,
        label: input.label,
        timezone,
        version: 1,
        createdAt: now,
        updatedAt: now,
        ...values,
      })
      .returning();
    if (!inserted) throw AppError.of(500, 'INTERNAL_ERROR');
    await enqueueUserContinuityRecomputes(tx, userId, now);
    return toDto(inserted);
  });
}

export async function patchContinuityProtectedBlock(
  userId: string,
  id: string,
  input: PatchContinuityProtectedBlockInput,
): Promise<ContinuityProtectedBlock> {
  return getDb().transaction(async (tx) => {
    const row = await loadOwned(userId, id);
    const now = new Date();
    const startAt = input.startAt !== undefined ? parseInstant(input.startAt) : row.startAt;
    const endAt = input.endAt !== undefined ? parseInstant(input.endAt) : row.endAt;
    if (row.kind === 'once' && startAt && endAt && endAt.getTime() <= startAt.getTime()) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    const startHm = input.startHm ?? row.startHm;
    const endHm = input.endHm ?? row.endHm;
    if (row.kind === 'weekly' && startHm && endHm && endHm <= startHm) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    const [updated] = await tx
      .update(continuityProtectedBlocks)
      .set({
        label: input.label ?? row.label,
        timezone: input.timezone ?? row.timezone,
        startAt,
        endAt,
        weekday: input.weekday ?? row.weekday,
        startHm,
        endHm,
        version: row.version + 1,
        updatedAt: now,
      })
      .where(eq(continuityProtectedBlocks.id, row.id))
      .returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    await enqueueUserContinuityRecomputes(tx, userId, now);
    return toDto(updated);
  });
}

export async function deleteContinuityProtectedBlock(userId: string, id: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = await loadOwned(userId, id);
    const now = new Date();
    await tx.delete(continuityProtectedBlocks).where(eq(continuityProtectedBlocks.id, row.id));
    await enqueueUserContinuityRecomputes(tx, userId, now);
  });
}
