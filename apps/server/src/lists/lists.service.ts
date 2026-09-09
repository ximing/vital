import { randomUUID } from 'node:crypto';
import {
  SMART_LIST_IDS,
  type CreateListInput,
  type List,
  type ListCollection,
  type PatchListInput,
  type ReorderListsInput,
} from '@vital/dto';
import { and, asc, eq, max } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { lists, tasks, users, type ListRow } from '../db/schema.js';
import { AppError } from '../errors.js';

export const INBOX_LIST_NAME = '收集箱';
export const SORT_GAP = 1024;

const SMART_NAMES: Record<(typeof SMART_LIST_IDS)[number], string> = {
  'smart:inbox': '收集箱',
  'smart:today': '今天',
  'smart:upcoming': '最近',
  'smart:someday': '无日期',
  'smart:done': '已完成',
};

const EPOCH = '1970-01-01T00:00:00.000Z';

function kindOf(value: string): List['kind'] {
  if (value === 'inbox' || value === 'user' || value === 'smart') return value;
  return 'user';
}

export function toListDto(row: ListRow): List {
  return {
    id: row.id,
    kind: kindOf(row.kind),
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sortOrder,
    isArchived: row.isArchived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function smartLists(): List[] {
  return SMART_LIST_IDS.map((id, i) => ({
    id,
    kind: 'smart' as const,
    name: SMART_NAMES[id],
    color: null,
    icon: null,
    sortOrder: i - SMART_LIST_IDS.length,
    isArchived: false,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  }));
}

export function inboxListValues(userId: string, now = new Date()): ListRow {
  return {
    id: randomUUID(),
    userId,
    kind: 'inbox',
    name: INBOX_LIST_NAME,
    color: null,
    icon: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getOwnedListOr404(userId: string, id: string): Promise<ListRow> {
  const [row] = await getDb().select().from(lists).where(eq(lists.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'LIST_NOT_FOUND');
  return row;
}

export async function getInboxList(userId: string): Promise<ListRow> {
  const [row] = await getDb()
    .select()
    .from(lists)
    .where(and(eq(lists.userId, userId), eq(lists.kind, 'inbox')))
    .limit(1);
  if (row) return row;
  const created = inboxListValues(userId);
  await getDb().insert(lists).values(created);
  return created;
}

export async function backfillInboxLists(): Promise<number> {
  const allUsers = await getDb().select({ id: users.id }).from(users);
  const existing = await getDb()
    .select({ userId: lists.userId })
    .from(lists)
    .where(eq(lists.kind, 'inbox'));
  const have = new Set(existing.map((r) => r.userId));
  let n = 0;
  for (const user of allUsers) {
    if (have.has(user.id)) continue;
    await getDb().insert(lists).values(inboxListValues(user.id));
    n += 1;
  }
  return n;
}

export async function listLists(userId: string): Promise<ListCollection> {
  const rows = await getDb()
    .select()
    .from(lists)
    .where(eq(lists.userId, userId))
    .orderBy(asc(lists.sortOrder), asc(lists.id));
  return { items: [...smartLists(), ...rows.map(toListDto)] };
}

export async function createList(userId: string, input: CreateListInput): Promise<List> {
  const [agg] = await getDb()
    .select({ m: max(lists.sortOrder) })
    .from(lists)
    .where(eq(lists.userId, userId));
  const now = new Date();
  const row: ListRow = {
    id: randomUUID(),
    userId,
    kind: 'user',
    name: input.name,
    color: input.color ?? null,
    icon: input.icon ?? null,
    sortOrder: (agg?.m ?? 0) + SORT_GAP,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(lists).values(row);
  return toListDto(row);
}

export async function patchList(userId: string, id: string, input: PatchListInput): Promise<List> {
  const row = await getOwnedListOr404(userId, id);
  const patch: Partial<ListRow> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.isArchived !== undefined) {
    if (row.kind === 'inbox' && input.isArchived) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    patch.isArchived = input.isArchived;
  }
  await getDb().update(lists).set(patch).where(eq(lists.id, row.id));
  return toListDto({ ...row, ...patch });
}

export async function deleteList(userId: string, id: string): Promise<void> {
  const row = await getOwnedListOr404(userId, id);
  if (row.kind === 'inbox') throw AppError.of(400, 'VALIDATION_ERROR');
  const inbox = await getInboxList(userId);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ listId: inbox.id, updatedAt: now })
      .where(and(eq(tasks.userId, userId), eq(tasks.listId, row.id)));
    await tx.delete(lists).where(eq(lists.id, row.id));
  });
}

export async function reorderLists(userId: string, input: ReorderListsInput): Promise<ListCollection> {
  const owned = await getDb().select().from(lists).where(eq(lists.userId, userId));
  const byId = new Map(owned.map((r) => [r.id, r]));
  for (const id of input.orderedIds) {
    if (!byId.has(id)) throw AppError.of(404, 'LIST_NOT_FOUND');
  }
  const now = new Date();
  await getDb().transaction(async (tx) => {
    for (let i = 0; i < input.orderedIds.length; i += 1) {
      const id = input.orderedIds[i];
      if (id === undefined) continue;
      await tx
        .update(lists)
        .set({ sortOrder: (i + 1) * SORT_GAP, updatedAt: now })
        .where(eq(lists.id, id));
    }
  });
  return listLists(userId);
}
