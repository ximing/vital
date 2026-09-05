import { randomUUID } from 'node:crypto';
import type { CreateTagInput, PatchTagInput, Tag, TagCollection } from '@vital/dto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { tags, type TagRow } from '../db/schema.js';
import { AppError } from '../errors.js';

function toTagDto(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getOwnedTagOr404(userId: string, id: string): Promise<TagRow> {
  const [row] = await getDb().select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'TAG_NOT_FOUND');
  return row;
}

export async function listTags(userId: string): Promise<TagCollection> {
  const rows = await getDb()
    .select()
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(asc(tags.name), asc(tags.id));
  return { items: rows.map(toTagDto) };
}

export async function createTag(userId: string, input: CreateTagInput): Promise<Tag> {
  const row: TagRow = {
    id: randomUUID(),
    userId,
    name: input.name,
    color: input.color ?? null,
    createdAt: new Date(),
  };
  try {
    await getDb().insert(tags).values(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.of(409, 'VALIDATION_ERROR');
    throw err;
  }
  return toTagDto(row);
}

export async function patchTag(userId: string, id: string, input: PatchTagInput): Promise<Tag> {
  const row = await getOwnedTagOr404(userId, id);
  const patch: Partial<TagRow> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color;
  try {
    await getDb()
      .update(tags)
      .set(patch)
      .where(and(eq(tags.id, row.id), eq(tags.userId, userId)));
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.of(409, 'VALIDATION_ERROR');
    throw err;
  }
  return toTagDto({ ...row, ...patch });
}

export async function deleteTag(userId: string, id: string): Promise<void> {
  await getOwnedTagOr404(userId, id);
  await getDb().delete(tags).where(eq(tags.id, id));
}

export async function assertOwnedTagIds(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await getDb()
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.id, unique)));
  if (rows.length !== unique.length) throw AppError.of(404, 'TAG_NOT_FOUND');
}
