import { eq } from 'drizzle-orm';
import { request } from 'undici';
import {
  INWIT_DEFAULT_BASE_URL,
  type InwitConfigInput,
  type InwitConfigPublic,
  type InwitTestResponse,
} from '@vital/dto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { userInwitConfig } from '../db/schema.js';
import { AppError } from '../errors.js';
import { isRedirectStatus, pinHttpTarget, type PinnedTarget } from '../extract/pin.js';
import { assertSafeUrl } from '../extract/ssrf.js';
import { logger } from '../utils/logger.js';
import { decryptSecret, encryptSecret } from '../llm/crypto.js';

export type StoredInwitConfig = {
  userId: string;
  baseUrl: string;
  accessKeyEnc: string;
  defaultTopicId: string | null;
};

/** Custom base URLs must survive the same SSRF rules as LLM providers (https required in prod). */
export function assertInwitBaseUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (config.NODE_ENV === 'production') {
    if (url.protocol !== 'https:') throw AppError.of(400, 'VALIDATION_ERROR');
    assertSafeUrl(url);
  }
}

async function loadStoredInwitConfig(userId: string): Promise<StoredInwitConfig | null> {
  const [row] = await getDb()
    .select()
    .from(userInwitConfig)
    .where(eq(userInwitConfig.userId, userId))
    .limit(1);
  return row ?? null;
}

export function inwitPublicOf(stored: StoredInwitConfig): InwitConfigPublic {
  return {
    baseUrl: stored.baseUrl,
    accessKeySet: stored.accessKeyEnc.length > 0,
    defaultTopicId: stored.defaultTopicId,
  };
}

export async function getInwitConfig(userId: string): Promise<InwitConfigPublic> {
  const stored = await loadStoredInwitConfig(userId);
  if (!stored) {
    return { baseUrl: INWIT_DEFAULT_BASE_URL, accessKeySet: false, defaultTopicId: null };
  }
  return inwitPublicOf(stored);
}

/** Decrypt-or-409 helper for callers that need the plaintext key. */
export async function requireInwitAccessKey(userId: string): Promise<{
  baseUrl: string;
  accessKey: string;
  defaultTopicId: string | null;
}> {
  const stored = await loadStoredInwitConfig(userId);
  if (!stored) throw AppError.of(409, 'INWIT_NOT_CONFIGURED');
  const accessKey = decryptSecret(stored.accessKeyEnc);
  if (!accessKey) throw AppError.of(409, 'INWIT_NOT_CONFIGURED');
  return { baseUrl: stored.baseUrl, accessKey, defaultTopicId: stored.defaultTopicId };
}

export async function putInwitConfig(
  userId: string,
  input: InwitConfigInput,
): Promise<InwitConfigPublic> {
  const stored = await loadStoredInwitConfig(userId);
  const baseUrl = input.baseUrl ?? stored?.baseUrl ?? INWIT_DEFAULT_BASE_URL;
  assertInwitBaseUrl(baseUrl);
  if (input.accessKey === undefined && !stored) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const now = new Date();
  const previousKeyEnc = stored === null ? '' : stored.accessKeyEnc;
  const accessKeyEnc =
    input.accessKey !== undefined ? encryptSecret(input.accessKey) : previousKeyEnc;
  const defaultTopicId =
    input.defaultTopicId !== undefined ? input.defaultTopicId : (stored?.defaultTopicId ?? null);
  if (stored) {
    await getDb()
      .update(userInwitConfig)
      .set({ baseUrl, accessKeyEnc, defaultTopicId, updatedAt: now })
      .where(eq(userInwitConfig.userId, userId));
  } else {
    await getDb().insert(userInwitConfig).values({
      userId,
      baseUrl,
      accessKeyEnc,
      defaultTopicId,
      createdAt: now,
      updatedAt: now,
    });
  }
  return getInwitConfig(userId);
}

function inwitFailureLog(err: unknown): string {
  if (err instanceof AppError) return err.code;
  if (err instanceof Error) return err.name;
  return 'Error';
}

/**
 * Pinned GET/POST. Redirects are not followed. Pin, DNS and network failures
 * are INWIT_UNREACHABLE and do not include a resolved address.
 */
export async function inwitRequest(
  url: URL,
  init: {
    method: 'GET' | 'POST';
    accessKey: string;
    body?: string;
    timeoutMs: number;
  },
): Promise<{ statusCode: number; text: string }> {
  const signal = AbortSignal.timeout(init.timeoutMs);
  let pinned: PinnedTarget | undefined;
  try {
    pinned = await pinHttpTarget(url, { production: config.NODE_ENV === 'production', signal });
    const res = await request(url.href, {
      method: init.method,
      dispatcher: pinned.dispatcher,
      maxRedirections: 0,
      signal,
      headers: {
        authorization: `Bearer ${init.accessKey}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    const text = await res.body.text();
    if (isRedirectStatus(res.statusCode)) throw AppError.of(502, 'INWIT_UNREACHABLE');
    return { statusCode: res.statusCode, text };
  } catch (err) {
    if (err instanceof AppError && err.code === 'INWIT_UNREACHABLE') throw err;
    logger.warn('inwit.request_failed', { error: inwitFailureLog(err) });
    throw AppError.of(502, 'INWIT_UNREACHABLE');
  } finally {
    if (pinned) await pinned.dispatcher.close();
  }
}

async function inwitGetJson(
  baseUrl: string,
  path: string,
  accessKey: string,
): Promise<{ status: number; body: unknown }> {
  const { statusCode, text } = await inwitRequest(new URL(path, baseUrl), {
    method: 'GET',
    accessKey,
    timeoutMs: 10_000,
  });
  if (text === '') return { status: statusCode, body: null };
  try {
    return { status: statusCode, body: JSON.parse(text) as unknown };
  } catch {
    return { status: statusCode, body: null };
  }
}

/** Verify the stored key against inwit and fetch the topic list in one call. */
export async function testInwitConfig(userId: string): Promise<InwitTestResponse> {
  const { baseUrl, accessKey } = await requireInwitAccessKey(userId);
  let res: { status: number; body: unknown };
  try {
    res = await inwitGetJson(baseUrl, '/api/topics', accessKey);
  } catch (err) {
    logger.warn('inwit.test_unreachable', { error: inwitFailureLog(err) });
    throw AppError.of(502, 'INWIT_UNREACHABLE');
  }
  if (res.status === 401) throw AppError.of(401, 'INWIT_KEY_INVALID');
  if (res.status === 403) throw AppError.of(403, 'INWIT_KEY_FORBIDDEN');
  if (res.status !== 200) throw AppError.of(502, 'INWIT_UNREACHABLE');
  // inwit returns a bare Topic[]; tolerate an {items: []} envelope just in case.
  const raw: unknown[] = Array.isArray(res.body)
    ? res.body
    : Array.isArray((res.body as { items?: unknown[] }).items)
      ? (res.body as { items: unknown[] }).items
      : [];
  const topics = raw.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { id?: unknown }).id === 'string' &&
      typeof (item as { title?: unknown }).title === 'string' &&
      (item as { status?: unknown }).status !== 'archived',
  );
  return {
    ok: true,
    topics: topics.map((item) => ({
      id: item.id as string,
      title: item.title as string,
    })),
  };
}
