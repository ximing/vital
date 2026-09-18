import { eq, inArray } from 'drizzle-orm';
import { request } from 'undici';
import {
  articleDocToHtml,
  attachmentIdOfUploadRef,
  textToArticleDoc,
  type ArticleBlockNode,
  type ArticleDoc,
} from '@vital/article-doc';
import type { InboxExportInwitResponse, InboxItem } from '@vital/dto';
import { getDb } from '../db/index.js';
import { attachments, inboxAssets, inboxItems } from '../db/schema.js';
import { AppError } from '../errors.js';
import { dtoOf, getOwnedInboxOr404, loadBodiesByItemIds } from '../inbox/inbox.service.js';
import { getStorage } from '../storage/factory.js';
import type { StorageMetadata } from '../storage/base.adapter.js';
import { logger } from '../utils/logger.js';
import { requireInwitAccessKey } from './inwit.service.js';

const OPEN_DOCUMENTS_PATH = '/api/open/documents';
/** SigV4 ceiling — public buckets ignore the TTL and return a permanent URL. */
const EXPORT_MEDIA_URL_TTL_SEC = 604_800;

function mapInwitStatus(status: number): never {
  if (status === 401) throw AppError.of(401, 'INWIT_KEY_INVALID');
  if (status === 403) throw AppError.of(403, 'INWIT_KEY_FORBIDDEN');
  if (status === 404) throw AppError.of(409, 'INWIT_TOPIC_INVALID');
  if (status === 429) throw AppError.of(429, 'INWIT_RATE_LIMITED');
  throw AppError.of(status === 400 ? 400 : 502, status === 400 ? 'INWIT_REJECTED' : 'INWIT_UNREACHABLE');
}

type AssetStorageRow = {
  attachmentId: string;
  s3Key: string;
  storageMeta: StorageMetadata;
};

async function loadAssetStorageRows(inboxItemId: string): Promise<Map<string, AssetStorageRow>> {
  const rows = await getDb()
    .select()
    .from(inboxAssets)
    .innerJoin(attachments, eq(inboxAssets.attachmentId, attachments.id))
    .where(inArray(inboxAssets.inboxItemId, [inboxItemId]));
  const map = new Map<string, AssetStorageRow>();
  for (const row of rows) {
    map.set(row.inbox_assets.attachmentId, {
      attachmentId: row.inbox_assets.attachmentId,
      s3Key: row.attachments.s3Key,
      storageMeta: row.attachments.storageMeta,
    });
  }
  return map;
}

/**
 * Swap upload refs for hosted URLs the inwit document can load. The bucket is
 * shared with inwit: public buckets yield a permanent URL, private buckets a
 * 7-day presign. Per-asset failures keep the original ref (inwit drops
 * unresolvable media) and never block the export.
 */
async function resolveDocMediaForExport(doc: ArticleDoc, inboxItemId: string): Promise<ArticleDoc> {
  const rows = await loadAssetStorageRows(inboxItemId);
  if (rows.size === 0) return doc;
  const urlCache = new Map<string, string | null>();
  const urlFor = async (attachmentId: string): Promise<string | null> => {
    const cached = urlCache.get(attachmentId);
    if (cached !== undefined) return cached;
    const row = rows.get(attachmentId);
    let url: string | null = null;
    if (row !== undefined) {
      try {
        url = await getStorage().generateAccessUrl(row.s3Key, row.storageMeta, EXPORT_MEDIA_URL_TTL_SEC);
      } catch (err) {
        logger.warn('inwit.asset_url_failed', {
          inboxItemId,
          attachmentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    urlCache.set(attachmentId, url);
    return url;
  };
  const swap = async (src: string): Promise<string> => {
    const attachmentId = attachmentIdOfUploadRef(src);
    if (attachmentId === null) return src;
    return (await urlFor(attachmentId)) ?? src;
  };
  const walk = async (blocks: ArticleBlockNode[]): Promise<ArticleBlockNode[]> =>
    Promise.all(
      blocks.map(async (block) => {
        switch (block.type) {
          case 'image':
            return { ...block, attrs: { ...block.attrs, src: await swap(block.attrs.src) } };
          case 'video': {
            const attrs = { ...block.attrs, src: await swap(block.attrs.src) };
            if (attrs.poster !== undefined) attrs.poster = await swap(attrs.poster);
            return { ...block, attrs };
          }
          case 'blockquote':
            return { ...block, content: await walk(block.content) };
          case 'bulletList':
          case 'orderedList':
            return {
              ...block,
              content: await Promise.all(
                block.content.map(async (item) => ({ ...item, content: await walk(item.content) })),
              ),
            };
          case 'table':
            return {
              ...block,
              content: await Promise.all(
                block.content.map(async (row) => ({
                  ...row,
                  content: await Promise.all(
                    row.content.map(async (cell) => ({ ...cell, content: await walk(cell.content) })),
                  ),
                })),
              ),
            };
          default:
            return block;
        }
      }),
    );
  return { type: 'doc', content: await walk(doc.content) };
}

/**
 * Export an inbox article to inwit as a document (PAT-authenticated open API).
 * Idempotent: an already-exported item returns its stored document id without re-sending.
 */
export async function exportInboxToInwit(
  userId: string,
  id: string,
): Promise<InboxExportInwitResponse> {
  const { baseUrl, accessKey, defaultTopicId } = await requireInwitAccessKey(userId);
  const item = await getOwnedInboxOr404(userId, id);

  if (item.inwitDocumentId) {
    return { inbox: await dtoOf(item), inwitDocumentId: item.inwitDocumentId };
  }

  const bodies = await loadBodiesByItemIds([id]);
  const body = bodies.get(id);
  const doc =
    body?.contentJson ??
    (body?.extractedText ? textToArticleDoc(body.extractedText) : null);
  if (doc === null || doc.content.length === 0) throw AppError.of(409, 'INWIT_EMPTY_BODY');
  const html = articleDocToHtml(await resolveDocMediaForExport(doc, id));

  const sourceUrl = item.canonicalUrl ?? item.originalUrl ?? undefined;
  const payload = {
    title: item.title,
    html,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(defaultTopicId ? { topicId: defaultTopicId } : {}),
  };

  let res: { statusCode: number; body: { text(): Promise<string> } };
  try {
    res = await request(new URL(OPEN_DOCUMENTS_PATH, baseUrl).toString(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    logger.warn('inwit.export_unreachable', {
      inboxItemId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw AppError.of(502, 'INWIT_UNREACHABLE');
  }

  const text = await res.body.text();
  if (res.statusCode !== 201) {
    logger.warn('inwit.export_rejected', { inboxItemId: id, status: res.statusCode, text: text.slice(0, 500) });
    mapInwitStatus(res.statusCode);
  }
  let documentId: string | undefined;
  try {
    const parsed = JSON.parse(text) as { id?: unknown };
    if (typeof parsed.id === 'string') documentId = parsed.id;
  } catch {
    documentId = undefined;
  }
  if (!documentId) {
    logger.warn('inwit.export_bad_response', { inboxItemId: id, status: res.statusCode });
    throw AppError.of(502, 'INWIT_UNREACHABLE');
  }

  const now = new Date();
  await getDb()
    .update(inboxItems)
    .set({ inwitDocumentId: documentId, inwitExportedAt: now, updatedAt: now })
    .where(eq(inboxItems.id, id));
  const updated: InboxItem = await dtoOf(await getOwnedInboxOr404(userId, id));
  return { inbox: updated, inwitDocumentId: documentId };
}
