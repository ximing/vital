import { randomUUID } from 'node:crypto';
import {
  SMART_LIST_IDS,
  type CreateListInput,
  type List,
  type ListCollection,
  type PatchListInput,
  type ReorderListsInput,
} from '@vital/dto';
import { and, asc, eq, isNull, max } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { attachments, lists, tasks, users, type ListRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { getStorage } from '../storage/factory.js';

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

function sameParent(row: ListRow, parentId: string | null): boolean {
  return (row.parentId ?? null) === parentId;
}

async function iconUrlOf(userId: string, attachmentId: string | null): Promise<string | null> {
  if (attachmentId === null) return null;
  const [row] = await getDb().select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!row || row.userId !== userId || row.status !== 'ready') return null;
  try {
    return await getStorage().generateAccessUrl(row.s3Key, row.storageMeta, 21_600);
  } catch {
    return null;
  }
}

export async function toListDto(row: ListRow): Promise<List> {
  return {
    id: row.id,
    kind: kindOf(row.kind),
    name: row.name,
    color: row.color,
    icon: row.icon,
    iconAttachmentId: row.iconAttachmentId,
    iconUrl: await iconUrlOf(row.userId, row.iconAttachmentId),
    parentId: row.parentId,
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
    iconAttachmentId: null,
    iconUrl: null,
    parentId: null,
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
    iconAttachmentId: null,
    parentId: null,
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

export async function listIdAndDescendants(userId: string, listId: string): Promise<string[]> {
  const list = await getOwnedListOr404(userId, listId);
  const children = await getDb()
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.userId, userId), eq(lists.parentId, list.id)));
  return [list.id, ...children.map((child) => child.id)];
}

async function childIdsOf(userId: string, parentId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.userId, userId), eq(lists.parentId, parentId)));
  return rows.map((row) => row.id);
}

async function nextSiblingSort(userId: string, parentId: string | null): Promise<number> {
  const cond =
    parentId === null
      ? and(eq(lists.userId, userId), isNull(lists.parentId))
      : and(eq(lists.userId, userId), eq(lists.parentId, parentId));
  const [agg] = await getDb().select({ m: max(lists.sortOrder) }).from(lists).where(cond);
  return (agg?.m ?? 0) + SORT_GAP;
}

async function assertNestParent(userId: string, parentId: string): Promise<ListRow> {
  const parent = await getOwnedListOr404(userId, parentId);
  if (parent.kind !== 'user' || parent.parentId !== null) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  return parent;
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
  return { items: [...smartLists(), ...(await Promise.all(rows.map((row) => toListDto(row))))] };
}

function applyIconPatch(
  patch: Partial<ListRow>,
  input: { icon?: string | null | undefined; iconAttachmentId?: string | null | undefined },
): void {
  if (input.icon !== undefined && input.icon !== null && input.iconAttachmentId) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (input.icon !== undefined) {
    patch.icon = input.icon;
    if (input.icon !== null) patch.iconAttachmentId = null;
  }
  if (input.iconAttachmentId !== undefined) {
    patch.iconAttachmentId = input.iconAttachmentId;
    if (input.iconAttachmentId !== null) patch.icon = null;
  }
}

export async function createList(userId: string, input: CreateListInput): Promise<List> {
  const parentId = input.parentId ?? null;
  if (parentId !== null) await assertNestParent(userId, parentId);
  if (input.icon && input.iconAttachmentId) throw AppError.of(400, 'VALIDATION_ERROR');
  const now = new Date();
  const row: ListRow = {
    id: randomUUID(),
    userId,
    kind: 'user',
    name: input.name,
    color: input.color ?? null,
    icon: input.iconAttachmentId ? null : (input.icon ?? null),
    iconAttachmentId: input.iconAttachmentId ?? null,
    parentId,
    sortOrder: await nextSiblingSort(userId, parentId),
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
  applyIconPatch(patch, input);
  if (input.isArchived !== undefined) {
    if (row.kind === 'inbox' && input.isArchived) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    patch.isArchived = input.isArchived;
  }
  if (input.parentId !== undefined) {
    if (row.kind !== 'user') throw AppError.of(400, 'VALIDATION_ERROR');
    const nextParent = input.parentId;
    if (nextParent === row.id) throw AppError.of(400, 'VALIDATION_ERROR');
    if (nextParent !== null) {
      await assertNestParent(userId, nextParent);
      const children = await childIdsOf(userId, row.id);
      if (children.length > 0) throw AppError.of(400, 'VALIDATION_ERROR');
      if (children.includes(nextParent)) throw AppError.of(400, 'VALIDATION_ERROR');
    }
    patch.parentId = nextParent;
    patch.sortOrder = await nextSiblingSort(userId, nextParent);
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
    const children = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.userId, userId), eq(lists.parentId, row.id)));
    if (children.length > 0) {
      const cond =
        row.parentId === null
          ? and(eq(lists.userId, userId), isNull(lists.parentId))
          : and(eq(lists.userId, userId), eq(lists.parentId, row.parentId));
      const [agg] = await tx.select({ m: max(lists.sortOrder) }).from(lists).where(cond);
      let sort = agg?.m ?? 0;
      for (const child of children) {
        sort += SORT_GAP;
        await tx
          .update(lists)
          .set({ parentId: row.parentId, sortOrder: sort, updatedAt: now })
          .where(eq(lists.id, child.id));
      }
    }
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
  if (input.parentId !== null) {
    const parent = byId.get(input.parentId);
    if (!parent || parent.kind !== 'user') throw AppError.of(404, 'LIST_NOT_FOUND');
  }
  for (const id of input.orderedIds) {
    const row = byId.get(id);
    if (!row || row.kind !== 'user') throw AppError.of(404, 'LIST_NOT_FOUND');
    if (!sameParent(row, input.parentId)) throw AppError.of(400, 'VALIDATION_ERROR');
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
