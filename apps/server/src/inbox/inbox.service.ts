import { randomUUID } from 'node:crypto';
import {
  INBOX_ASSET_MIME_TYPES,
  type ConvertInboxInput,
  type ConvertInboxResponse,
  type CreateInboxInput,
  type InboxAsset,
  type InboxCollection,
  type InboxItem,
  type InboxMarkdown,
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
  inboxIdempotencyResponses,
  inboxItemBodies,
  inboxItemTags,
  inboxItems,
  type InboxIdempotencyResponse,
  type InboxItemRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getInboxList } from '../lists/lists.service.js';
import { assertOwnedOutcomeId } from '../outcomes/shared.js';
import { trackIndexJob } from '../retrieval/pipeline.js';
import { indexInboxItem, removeInboxItemIndex } from '../retrieval/search.js';
import { assertOwnedTagIds } from '../tags/tags.service.js';
import { createTaskInTx, fireIndexTask, getTask } from '../tasks/tasks.service.js';
import { bindUpload } from '../uploads/uploads.service.js';
import { getStorage, type StorageMetadata } from '../storage/factory.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import { idempotencyKeyForUrl } from './canonical.js';
import {
  articleDocToText,
  htmlToArticleDoc,
  pmJsonToArticleDoc,
  rebindDocMedia,
  textToArticleDoc,
  type ArticleDoc,
  type DocAssetRef,
} from '@vital/article-doc';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown } from '@vital/markdown';

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

function nonemptyDoc(doc: ArticleDoc | null): ArticleDoc | null {
  return doc !== null && doc.content.length > 0 ? doc : null;
}

function markdownToArticleDoc(markdown: string): ArticleDoc {
  return pmJsonToArticleDoc(parseMarkdownToPmJSON(markdown));
}

/**
 * Body doc on write. Priority: contentJson > HTML > markdown > plain text.
 * Media srcs are bound to the item's current assets.
 */
function docOnWrite(
  contentJson: ArticleDoc | null | undefined,
  extractedText: string | null,
  assets: readonly DocAssetRef[],
  extractedHtml?: string | null,
  markdown?: string | null,
): ArticleDoc | null {
  const html = clip(extractedHtml ?? null, 2 * 1024 * 1024);
  const fromHtml = html !== null ? htmlToArticleDoc(html) : null;
  const md = clip(markdown ?? null, 2 * 1024 * 1024);
  const fromMd = md !== null ? markdownToArticleDoc(md) : null;
  const doc =
    contentJson ??
    nonemptyDoc(fromHtml) ??
    nonemptyDoc(fromMd) ??
    (extractedText !== null && extractedText !== '' ? textToArticleDoc(extractedText) : null);
  if (doc === null) return null;
  return rebindDocMedia(doc, assets);
}

function textForBody(explicit: string | null | undefined, doc: ArticleDoc | null, fallback: string | null): string | null {
  if (explicit !== undefined) return explicit;
  if (doc !== null) {
    const derived = clip(articleDocToText(doc), 2 * 1024 * 1024);
    if (derived !== null) return derived;
  }
  return fallback;
}

type InboxBody = { extractedText: string | null; contentJson: ArticleDoc | null };

type InboxDtoRow = Pick<
  InboxItemRow,
  | 'id'
  | 'title'
  | 'outcomeId'
  | 'originalUrl'
  | 'canonicalUrl'
  | 'excerpt'
  | 'byline'
  | 'siteName'
  | 'status'
  | 'source'
  | 'capturedAt'
  | 'readAt'
  | 'convertedTaskId'
  | 'inwitDocumentId'
  | 'inwitExportedAt'
  | 'deletedAt'
  | 'createdAt'
  | 'updatedAt'
>;

/** List/sync columns — omits generated tsvector. Idempotency snapshots live on a side table. */
const inboxListColumns = {
  id: inboxItems.id,
  userId: inboxItems.userId,
  title: inboxItems.title,
  outcomeId: inboxItems.outcomeId,
  originalUrl: inboxItems.originalUrl,
  canonicalUrl: inboxItems.canonicalUrl,
  excerpt: inboxItems.excerpt,
  byline: inboxItems.byline,
  siteName: inboxItems.siteName,
  status: inboxItems.status,
  source: inboxItems.source,
  capturedAt: inboxItems.capturedAt,
  readAt: inboxItems.readAt,
  idempotencyKey: inboxItems.idempotencyKey,
  convertedTaskId: inboxItems.convertedTaskId,
  inwitDocumentId: inboxItems.inwitDocumentId,
  inwitExportedAt: inboxItems.inwitExportedAt,
  deletedAt: inboxItems.deletedAt,
  createdAt: inboxItems.createdAt,
  updatedAt: inboxItems.updatedAt,
};

export function toInboxDto(
  row: InboxDtoRow,
  assets: InboxAsset[],
  tagIds: string[] = [],
  body: InboxBody | null = null,
): InboxItem {
  return {
    id: row.id,
    title: row.title,
    outcomeId: row.outcomeId,
    originalUrl: row.originalUrl,
    canonicalUrl: row.canonicalUrl,
    extractedText: body?.extractedText ?? null,
    contentJson: body?.contentJson ?? null,
    excerpt: row.excerpt,
    byline: row.byline,
    siteName: row.siteName,
    status: asStatus(row.status),
    source: asSource(row.source),
    capturedAt: row.capturedAt.toISOString(),
    readAt: iso(row.readAt),
    convertedTaskId: row.convertedTaskId,
    inwitDocumentId: row.inwitDocumentId,
    inwitExportedAt: iso(row.inwitExportedAt),
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

export async function loadBodiesByItemIds(ids: string[]): Promise<Map<string, InboxBody>> {
  const map = new Map<string, InboxBody>();
  if (ids.length === 0) return map;
  const rows = await getDb()
    .select()
    .from(inboxItemBodies)
    .where(inArray(inboxItemBodies.inboxItemId, ids));
  for (const row of rows) {
    map.set(row.inboxItemId, {
      extractedText: row.extractedText,
      contentJson: row.contentJson,
    });
  }
  return map;
}

async function writeInboxBody(
  inboxItemId: string,
  extractedText: string | null,
  contentJson: ArticleDoc | null,
  db: Pick<ReturnType<typeof getDb>, 'insert'> = getDb(),
): Promise<void> {
  await db
    .insert(inboxItemBodies)
    .values({ inboxItemId, extractedText, contentJson })
    .onConflictDoUpdate({
      target: inboxItemBodies.inboxItemId,
      set: { extractedText, contentJson },
    });
}

export async function dtoOf(row: InboxItemRow): Promise<InboxItem> {
  const [assets, tags, bodies] = await Promise.all([
    loadAssetsByItemIds([row.id]),
    tagIdsByInbox([row.id]),
    loadBodiesByItemIds([row.id]),
  ]);
  return toInboxDto(row, assets.get(row.id) ?? [], tags.get(row.id) ?? [], bodies.get(row.id) ?? null);
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

async function loadIdempotencyReplay(
  inboxItemId: string,
  db: Pick<ReturnType<typeof getDb>, 'select'> = getDb(),
): Promise<InboxIdempotencyResponse | null> {
  const [row] = await db
    .select({ response: inboxIdempotencyResponses.response })
    .from(inboxIdempotencyResponses)
    .where(eq(inboxIdempotencyResponses.inboxItemId, inboxItemId))
    .limit(1);
  return replayOf(row?.response ?? null);
}

async function writeIdempotencyResponse(
  inboxItemId: string,
  response: InboxIdempotencyResponse,
  db: Pick<ReturnType<typeof getDb>, 'insert'> = getDb(),
): Promise<void> {
  await db
    .insert(inboxIdempotencyResponses)
    .values({ inboxItemId, response })
    .onConflictDoUpdate({
      target: inboxIdempotencyResponses.inboxItemId,
      set: { response },
    });
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
    .select(inboxListColumns)
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

export async function getInboxMarkdown(userId: string, id: string): Promise<InboxMarkdown> {
  const item = await dtoOf(await getOwnedInboxOr404(userId, id));
  if (item.contentJson === null || item.contentJson.content.length === 0) {
    return { markdown: '' };
  }
  return { markdown: serializePmJSONToMarkdown(item.contentJson) };
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

  const givenText =
    input.extractedText !== undefined ? clip(input.extractedText, 2 * 1024 * 1024) : undefined;
  // New items have no assets yet; patchInboxAssets rebinds media once uploads land.
  const contentJson = docOnWrite(
    input.contentJson,
    givenText ?? null,
    [],
    input.extractedHtml,
    input.markdown,
  );
  const extractedText = textForBody(givenText, contentJson, null);
  const excerpt = clip(input.excerpt ?? extractedText, 500);
  const now = new Date();
  const id = randomUUID();
  const row = {
    id,
    userId,
    title: input.title,
    originalUrl,
    canonicalUrl,
    excerpt,
    byline: clip(input.byline ?? null, 200),
    siteName: clip(input.siteName ?? null, 200),
    status: 'unread' as const,
    source,
    capturedAt: now,
    readAt: null,
    idempotencyKey: key,
    convertedTaskId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  if (key === null) {
    await getDb().transaction(async (tx) => {
      await tx.insert(inboxItems).values(row);
      await writeInboxBody(id, extractedText, contentJson, tx);
      if (input.tagIds !== undefined) await replaceInboxTags(id, input.tagIds, tx);
    });
    const stored = await getOwnedInboxOr404(userId, id);
    trackIndexJob(indexInboxItem(stored), 'indexInboxItem');
    const created = await dtoOf(stored);
    return { status: 201, item: created };
  }

  const { createdRow, ...result } = await getDb().transaction(async (tx) => {
    await tx
      .insert(inboxItems)
      .values(row)
      .onConflictDoNothing({
        target: [inboxItems.userId, inboxItems.idempotencyKey],
        where: sql`${inboxItems.idempotencyKey} IS NOT NULL AND ${inboxItems.deletedAt} IS NULL`,
      });
    const [stored] = await tx
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          eq(inboxItems.idempotencyKey, key),
          isNull(inboxItems.deletedAt),
        ),
      )
      .limit(1);
    if (!stored) throw AppError.of(500, 'INTERNAL_ERROR');
    if (stored.id !== id) {
      const replay = await loadIdempotencyReplay(stored.id, tx);
      if (replay && isInboxItemBody(replay.body)) {
        const body = replay.body;
        return {
          status: 200 as const,
          item: { ...body, tagIds: Array.isArray(body.tagIds) ? body.tagIds : [] },
          createdRow: null,
        };
      }
      const current = await dtoOf(stored);
      return { status: 200 as const, item: current, createdRow: null };
    }
    await writeInboxBody(stored.id, extractedText, contentJson, tx);
    if (input.tagIds !== undefined) await replaceInboxTags(stored.id, input.tagIds, tx);
    const created = toInboxDto(stored, [], input.tagIds ?? [], { extractedText, contentJson });
    const payload: InboxIdempotencyResponse = { status: 201, body: created };
    await writeIdempotencyResponse(stored.id, payload, tx);
    return { status: 201 as const, item: created, createdRow: stored };
  });
  if (createdRow !== null) {
    trackIndexJob(indexInboxItem(createdRow), 'indexInboxItem');
  }
  return result;
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
  if (input.excerpt !== undefined) patch.excerpt = input.excerpt;
  if (input.byline !== undefined) patch.byline = input.byline;
  if (input.siteName !== undefined) patch.siteName = input.siteName;
  if (input.readAt !== undefined) {
    patch.readAt = input.readAt === null ? null : new Date(input.readAt);
  }
  await getDb().transaction(async (tx) => {
    await tx.update(inboxItems).set(patch).where(eq(inboxItems.id, row.id));
    if (
      input.extractedText !== undefined ||
      input.contentJson !== undefined ||
      input.extractedHtml !== undefined ||
      input.markdown !== undefined
    ) {
      const [current] = await tx
        .select()
        .from(inboxItemBodies)
        .where(eq(inboxItemBodies.inboxItemId, row.id))
        .limit(1);
      const givenText = input.extractedText !== undefined ? input.extractedText : undefined;
      const assetRefs = await tx
        .select({
          attachmentId: inboxAssets.attachmentId,
          originalSrc: inboxAssets.originalSrc,
        })
        .from(inboxAssets)
        .where(eq(inboxAssets.inboxItemId, row.id));
      const replaceDoc =
        input.contentJson !== undefined ||
        input.extractedHtml !== undefined ||
        input.markdown !== undefined;
      const nextDoc = docOnWrite(
        replaceDoc ? input.contentJson : (current?.contentJson ?? null),
        givenText ?? current?.extractedText ?? null,
        assetRefs,
        input.extractedHtml,
        input.markdown,
      );
      const extractedText = textForBody(
        givenText,
        replaceDoc ? nextDoc : null,
        current?.extractedText ?? null,
      );
      await writeInboxBody(row.id, extractedText, nextDoc, tx);
    }
    if (input.tagIds !== undefined) await replaceInboxTags(row.id, input.tagIds, tx);
  });
  const fresh = await getOwnedInboxOr404(userId, id);
  trackIndexJob(indexInboxItem(fresh), 'indexInboxItem');
  return dtoOf(fresh);
}

export async function deleteInbox(userId: string, id: string): Promise<void> {
  const row = await getOwnedInboxOr404(userId, id);
  const now = new Date();
  await getDb()
    .update(inboxItems)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(inboxItems.id, row.id));
  trackIndexJob(removeInboxItemIndex(id), 'removeInboxItemIndex');
}

function isInboxAssetMime(mime: string): boolean {
  return (INBOX_ASSET_MIME_TYPES as readonly string[]).includes(mime);
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
    if (att.status !== 'ready' || !isInboxAssetMime(att.mime)) {
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
    if (input.assets.length > 0) {
      await tx.insert(inboxAssets).values(
        input.assets.map((asset) => ({
          id: randomUUID(),
          inboxItemId: item.id,
          attachmentId: asset.attachmentId,
          originalSrc: asset.originalSrc,
          sortOrder: asset.sortOrder,
        })),
      );
    }
    // Uploads arrived after the body: bind media srcs to the new attachments.
    const [body] = await tx
      .select()
      .from(inboxItemBodies)
      .where(eq(inboxItemBodies.inboxItemId, item.id))
      .limit(1);
    if (body?.contentJson != null) {
      const rebound = rebindDocMedia(body.contentJson, input.assets);
      if (rebound !== body.contentJson) {
        await tx
          .update(inboxItemBodies)
          .set({ contentJson: rebound })
          .where(eq(inboxItemBodies.inboxItemId, item.id));
      }
    }
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
  const created = await getDb().transaction(async (tx) => {
    const taskRow = await createTaskInTx(tx, userId, {
      title: input.title ?? item.title,
      listId,
      notes: item.originalUrl ?? item.excerpt ?? '',
      ...(tagIds.length > 0 ? { tagIds } : {}),
    });
    const now = new Date();
    await tx.insert(entityLinks).values([
      {
        id: randomUUID(),
        userId,
        fromType: 'inbox',
        fromId: item.id,
        toType: 'task',
        toId: taskRow.id,
        role: 'converted_from',
        createdAt: now,
      },
      {
        id: randomUUID(),
        userId,
        fromType: 'task',
        fromId: taskRow.id,
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
        convertedTaskId: taskRow.id,
        updatedAt: now,
      })
      .where(eq(inboxItems.id, item.id));
    return taskRow;
  });
  fireIndexTask(created);
  const updated = await getOwnedInboxOr404(userId, id);
  trackIndexJob(indexInboxItem(updated), 'indexInboxItem');
  return { created: true, result: { inbox: await dtoOf(updated), task: await getTask(userId, created.id) } };
}
