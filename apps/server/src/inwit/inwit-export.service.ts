import { eq } from 'drizzle-orm';
import { request } from 'undici';
import type { InboxExportInwitResponse, InboxItem } from '@vital/dto';
import { getDb } from '../db/index.js';
import { inboxItems } from '../db/schema.js';
import { AppError } from '../errors.js';
import { dtoOf, getOwnedInboxOr404, loadBodiesByItemIds } from '../inbox/inbox.service.js';
import { logger } from '../utils/logger.js';
import { requireInwitAccessKey } from './inwit.service.js';

const OPEN_DOCUMENTS_PATH = '/api/open/documents';

function textToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
    .join('');
}

function mapInwitStatus(status: number): never {
  if (status === 401) throw AppError.of(401, 'INWIT_KEY_INVALID');
  if (status === 403) throw AppError.of(403, 'INWIT_KEY_FORBIDDEN');
  if (status === 404) throw AppError.of(409, 'INWIT_TOPIC_INVALID');
  if (status === 429) throw AppError.of(429, 'INWIT_RATE_LIMITED');
  throw AppError.of(status === 400 ? 400 : 502, status === 400 ? 'INWIT_REJECTED' : 'INWIT_UNREACHABLE');
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
  const html = body?.extractedHtml ?? (body?.extractedText ? textToHtml(body.extractedText) : null);
  if (!html) throw AppError.of(409, 'INWIT_EMPTY_BODY');

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
