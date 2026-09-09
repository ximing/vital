import { randomUUID } from 'node:crypto';
import {
  IMAGE_MIME_TYPES,
  type ConvertInboxInput,
  type ConvertInboxResponse,
  type CreateInboxInput,
  type InboxAsset,
  type InboxCollection,
  type InboxItem,
  type InboxSource,
  type InboxStatus,
  type ListInboxQuery,
  type PatchInboxAssetsInput,
  type PatchInboxInput,
} from '@vital/dto';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  attachments,
  entityLinks,
  inboxAssets,
  inboxItemTags,
  inboxItems,
  type InboxIdempotencyResponse,
  type InboxItemRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getInboxList } from '../lists/lists.service.js';
import { assertOwnedOutcomeId } from '../outcomes/shared.js';
import { assertOwnedTagIds } from '../tags/tags.service.js';
import { createTask, getTask } from '../tasks/tasks.service.js';
import { bindUpload } from '../uploads/uploads.service.js';
import { getStorage, type StorageMetadata } from '../storage/factory.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import { idempotencyKeyForUrl } from './canonical.js';
import { escapeParagraph, sanitizeExtractedHtml } from './sanitize.js';

function asStatus(value: string): InboxStatus {
  if (value === 'unread' || value === 'later' || value === 'archived' || value === 'converted') {
    return value;
  }
  return 'unread';
}

function asSource(value: string): InboxSource {
  if (
    value === 'extension' ||
    value === 'wechat' ||
    value === 'web' ||
    value === 'mobile' ||
    value === 'manual'
  ) {
    return value;
  }
  return 'manual';
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function clip(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function htmlOnWrite(
  html: string | null | undefined,
  text: string | null | undefined,
): string | null {
  if (html !== undefined && html !== null) {
    const clean = sanitizeExtractedHtml(html);
    return clean === '' ? null : clean;
  }
  if (text !== undefined && text !== null && text !== '') return escapeParagraph(text);
  return null;
}

export function toInboxDto(
  row: InboxItemRow,
  assets: InboxAsset[],
  tagIds: string[] = [],
): InboxItem {
  return {
    id: row.id,
    title: row.title,
    outcomeId: row.outcomeId,
    originalUrl: row.originalUrl,
    canonicalUrl: row.canonicalUrl,
    extractedText: row.extractedText,
    extractedHtml: row.extractedHtml,
    excerpt: row.excerpt,
    byline: row.byline,
    siteName: row.siteName,
    status: asStatus(row.status),
    source: asSource(row.source),
    capturedAt: row.capturedAt.toISOString(),
    readAt: iso(row.readAt),
    convertedTaskId: row.convertedTaskId,
    tagIds,
    assets,
    deletedAt: iso(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function tagIdsByInbox(ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const id of ids) map.set(id, []);
  if (ids.length === 0) return map;
  const rows = await getDb()
    .select()
    .from(inboxItemTags)
    .where(inArray(inboxItemTags.inboxItemId, ids));
  for (const row of rows) {
    const current = map.get(row.inboxItemId);
    if (current) current.push(row.tagId);
    else map.set(row.inboxItemId, [row.tagId]);
  }
  return map;
}

async function replaceInboxTags(
  inboxItemId: string,
  tagIds: string[],
  db: Pick<ReturnType<typeof getDb>, 'delete' | 'insert'> = getDb(),
): Promise<void> {
  await db.delete(inboxItemTags).where(eq(inboxItemTags.inboxItemId, inboxItemId));
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  await db.insert(inboxItemTags).values(unique.map((tagId) => ({ inboxItemId, tagId })));
}

async function toAssetDto(row: {
  id: string;
  attachmentId: string;
  mime: string;
  originalSrc: string;
  sortOrder: number;
  s3Key: string;
  storageMeta: StorageMetadata;
}): Promise<InboxAsset> {
  return {
    id: row.id,
    attachmentId: row.attachmentId,
    mime: row.mime,
    url: await getStorage().generateAccessUrl(row.s3Key, row.storageMeta, 21_600),
    originalSrc: row.originalSrc,
    sortOrder: row.sortOrder,
  };
}

export async function loadAssetsByItemIds(ids: string[]): Promise<Map<string, InboxAsset[]>> {
  const map = new Map<string, InboxAsset[]>();
  for (const id of ids) map.set(id, []);
  if (ids.length === 0) return map;
  const rows = await getDb()
    .select()
    .from(inboxAssets)
    .innerJoin(attachments, eq(inboxAssets.attachmentId, attachments.id))
    .where(inArray(inboxAssets.inboxItemId, ids));
  for (const row of rows) {
    const list = map.get(row.inbox_assets.inboxItemId);
    if (list) list.push(await toAssetDto({
      id: row.inbox_assets.id,
      attachmentId: row.inbox_assets.attachmentId,
      mime: row.attachments.mime,
      originalSrc: row.inbox_assets.originalSrc,
      sortOrder: row.inbox_assets.sortOrder,
      s3Key: row.attachments.s3Key,
      storageMeta: row.attachments.storageMeta,
    }));
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }
  return map;
}

async function dtoOf(row: InboxItemRow): Promise<InboxItem> {
  const [assets, tags] = await Promise.all([
    loadAssetsByItemIds([row.id]),
    tagIdsByInbox([row.id]),
  ]);
  return toInboxDto(row, assets.get(row.id) ?? [], tags.get(row.id) ?? []);
}

export async function getOwnedInboxOr404(
  userId: string,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<InboxItemRow> {
  const [row] = await getDb().select().from(inboxItems).where(eq(inboxItems.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'INBOX_NOT_FOUND');
  if (!opts.includeDeleted && row.deletedAt) throw AppError.of(404, 'INBOX_NOT_FOUND');
  return row;
}

function replayOf(value: InboxIdempotencyResponse | null): InboxIdempotencyResponse | null {
  if (value === null) return null;
  if (typeof value.status !== 'number') return null;
  return { status: value.status, body: value.body };
}

function isInboxItemBody(value: unknown): value is InboxItem {
  return typeof value === 'object' && value !== null && 'id' in value && 'title' in value;
}

export async function listInbox(userId: string, query: ListInboxQuery): Promise<InboxCollection> {
  const limit = query.limit;
  const filters: SQL[] = [eq(inboxItems.userId, userId), isNull(inboxItems.deletedAt)];
  if (query.status !== undefined) filters.push(eq(inboxItems.status, query.status));
  if (query.tagId !== undefined) {
    filters.push(
      sql`exists (select 1 from inbox_item_tags where inbox_item_id = ${inboxItems.id} and tag_id = ${query.tagId})`,
    );
  }
  let where: SQL = and(...filters) as SQL;
  if (query.cursor !== undefined) {
    const cur = decodeCursor(query.cursor);
    const t = new Date(cur.t);
    where = and(
      where,
      or(
        lt(inboxItems.capturedAt, t),
        and(eq(inboxItems.capturedAt, t), sql`${inboxItems.id} < ${cur.id}`),
      ),
    ) as SQL;
  }
  const rows = await getDb()
    .select()
    .from(inboxItems)
    .where(where)
    .orderBy(desc(inboxItems.capturedAt), desc(inboxItems.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const ids = page.map((r) => r.id);
  const [assets, tags] = await Promise.all([loadAssetsByItemIds(ids), tagIdsByInbox(ids)]);
  const items = page.map((r) => toInboxDto(r, assets.get(r.id) ?? [], tags.get(r.id) ?? []));
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = page[page.length - 1];
    if (last) nextCursor = encodeCursor(last.capturedAt.toISOString(), last.id);
  }
  return { items, nextCursor };
}

export async function getInbox(userId: string, id: string): Promise<InboxItem> {
  return dtoOf(await getOwnedInboxOr404(userId, id));
}

export async function createInbox(
  userId: string,
  input: CreateInboxInput,
  headerKey: string | undefined,
): Promise<{ status: number; item: InboxItem }> {
  const source = input.source ?? 'manual';
  if (source === 'extension' && headerKey === undefined) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (input.tagIds !== undefined) await assertOwnedTagIds(userId, input.tagIds);

  const originalUrl: string | null = input.originalUrl ?? null;
  let canonicalUrl: string | null = null;
  let key: string | null = null;
  if (originalUrl !== null) {
    const computed = idempotencyKeyForUrl(originalUrl);
    canonicalUrl = computed.canonicalUrl;
    key = computed.key;
    if (headerKey !== undefined && headerKey !== key) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
  } else if (headerKey !== undefined) {
    key = headerKey;
  }

  const extractedText = clip(input.extractedText ?? null, 2 * 1024 * 1024);
  const extractedHtml = htmlOnWrite(input.extractedHtml, extractedText);
  const excerpt = clip(input.excerpt ?? extractedText, 500);
  const now = new Date();
  const id = randomUUID();
  const row = {
    id,
    userId,
    title: input.title,
    originalUrl,
    canonicalUrl,
    extractedText,
    extractedHtml,
    excerpt,
    byline: clip(input.byline ?? null, 200),
    siteName: clip(input.siteName ?? null, 200),
    status: 'unread' as const,
    source,
    capturedAt: now,
    readAt: null,
    idempotencyKey: key,
    idempotencyResponse: null,
    convertedTaskId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  if (key === null) {
    await getDb().insert(inboxItems).values(row);
    if (input.tagIds !== undefined) await replaceInboxTags(id, input.tagIds);
    const created = await dtoOf(await getOwnedInboxOr404(userId, id));
    return { status: 201, item: created };
  }

  return getDb().transaction(async (tx) => {
    await tx
      .insert(inboxItems)
      .values(row)
      .onConflictDoNothing({
        target: [inboxItems.userId, inboxItems.idempotencyKey],
        where: sql`${inboxItems.idempotencyKey} IS NOT NULL`,
      });
    const [stored] = await tx
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.userId, userId), eq(inboxItems.idempotencyKey, key)))
      .limit(1);
    if (!stored) throw AppError.of(500, 'INTERNAL_ERROR');
    if (stored.id !== id) {
      const replay = replayOf(stored.idempotencyResponse ?? null);
      if (replay && isInboxItemBody(replay.body)) {
        const body = replay.body;
        return {
          status: 200,
          item: { ...body, tagIds: Array.isArray(body.tagIds) ? body.tagIds : [] },
        };
      }
      const current = await dtoOf(stored);
      return { status: 200, item: current };
    }
    if (input.tagIds !== undefined) await replaceInboxTags(stored.id, input.tagIds, tx);
    const created = toInboxDto(stored, [], input.tagIds ?? []);
    const payload: InboxIdempotencyResponse = { status: 201, body: created };
    await tx
      .update(inboxItems)
      .set({ idempotencyResponse: payload })
      .where(eq(inboxItems.id, stored.id));
    return { status: 201, item: created };
  });
}

export async function patchInbox(
  userId: string,
  id: string,
  input: PatchInboxInput,
): Promise<InboxItem> {
  const row = await getOwnedInboxOr404(userId, id);
  if (input.tagIds !== undefined) await assertOwnedTagIds(userId, input.tagIds);
  if (input.outcomeId) await assertOwnedOutcomeId(userId, input.outcomeId);
  const now = new Date();
  const patch: Partial<InboxItemRow> = { updatedAt: now };
  if (input.title !== undefined) patch.title = input.title;
  if (input.status !== undefined) patch.status = input.status;
  if (input.outcomeId !== undefined) patch.outcomeId = input.outcomeId;
  if (input.extractedText !== undefined) patch.extractedText = input.extractedText;
  if (input.extractedHtml !== undefined) {
    patch.extractedHtml =
      input.extractedHtml === null ? null : sanitizeExtractedHtml(input.extractedHtml);
  }
  if (input.excerpt !== undefined) patch.excerpt = input.excerpt;
  if (input.byline !== undefined) patch.byline = input.byline;
  if (input.siteName !== undefined) patch.siteName = input.siteName;
  if (input.readAt !== undefined) {
    patch.readAt = input.readAt === null ? null : new Date(input.readAt);
  }
  await getDb().update(inboxItems).set(patch).where(eq(inboxItems.id, row.id));
  if (input.tagIds !== undefined) await replaceInboxTags(row.id, input.tagIds);
  return dtoOf(await getOwnedInboxOr404(userId, id));
}

export async function deleteInbox(userId: string, id: string): Promise<void> {
  const row = await getOwnedInboxOr404(userId, id);
  const now = new Date();
  await getDb()
    .update(inboxItems)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(inboxItems.id, row.id));
}

function isImageMime(mime: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

export async function patchInboxAssets(
  userId: string,
  id: string,
  input: PatchInboxAssetsInput,
): Promise<InboxItem> {
  const item = await getOwnedInboxOr404(userId, id);
  const seen = new Set<string>();
  for (const asset of input.assets) {
    if (seen.has(asset.attachmentId)) throw AppError.of(400, 'VALIDATION_ERROR');
    seen.add(asset.attachmentId);
  }
  const ids = input.assets.map((a) => a.attachmentId);
  const rows =
    ids.length === 0
      ? []
      : await getDb().select().from(attachments).where(inArray(attachments.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const asset of input.assets) {
    const att = byId.get(asset.attachmentId);
    if (!att || att.userId !== userId) throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
    if (att.status !== 'ready' || !isImageMime(att.mime)) {
      throw AppError.of(409, 'MEDIA_INVALID_STATE');
    }
    if (att.ownerType === 'tmp') {
      await bindUpload(userId, att.id, { ownerType: 'inbox', ownerId: item.id });
    } else if (att.ownerType !== 'inbox' || att.ownerId !== item.id) {
      throw AppError.of(409, 'MEDIA_INVALID_STATE');
    }
  }
  await getDb().transaction(async (tx) => {
    await tx.delete(inboxAssets).where(eq(inboxAssets.inboxItemId, item.id));
    if (input.assets.length === 0) return;
    await tx.insert(inboxAssets).values(
      input.assets.map((asset) => ({
        id: randomUUID(),
        inboxItemId: item.id,
        attachmentId: asset.attachmentId,
        originalSrc: asset.originalSrc,
        sortOrder: asset.sortOrder,
      })),
    );
    await tx.update(inboxItems).set({ updatedAt: new Date() }).where(eq(inboxItems.id, item.id));
  });
  return dtoOf(await getOwnedInboxOr404(userId, id));
}

export async function convertInbox(
  userId: string,
  id: string,
  input: ConvertInboxInput,
): Promise<{ created: boolean; result: ConvertInboxResponse }> {
  const item = await getOwnedInboxOr404(userId, id);
  if (item.convertedTaskId) {
    try {
      const task = await getTask(userId, item.convertedTaskId);
      return { created: false, result: { inbox: await dtoOf(item), task } };
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'TASK_NOT_FOUND') throw err;
    }
  }
  const listId = input.listId ?? (await getInboxList(userId)).id;
  const tagIds = (await tagIdsByInbox([item.id])).get(item.id) ?? [];
  const task = await createTask(userId, {
    title: input.title ?? item.title,
    listId,
    notes: item.originalUrl ?? item.excerpt ?? '',
    ...(tagIds.length > 0 ? { tagIds } : {}),
  });
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.insert(entityLinks).values([
      {
        id: randomUUID(),
        userId,
        fromType: 'inbox',
        fromId: item.id,
        toType: 'task',
        toId: task.id,
        role: 'converted_from',
        createdAt: now,
      },
      {
        id: randomUUID(),
        userId,
        fromType: 'task',
        fromId: task.id,
        toType: 'inbox',
        toId: item.id,
        role: 'converted_from',
        createdAt: now,
      },
    ]);
    await tx
      .update(inboxItems)
      .set({
        status: 'converted',
        convertedTaskId: task.id,
        updatedAt: now,
      })
      .where(eq(inboxItems.id, item.id));
  });
  const updated = await getOwnedInboxOr404(userId, id);
  return { created: true, result: { inbox: await dtoOf(updated), task } };
}
