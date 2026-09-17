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

async function inwitGetJson(
  baseUrl: string,
  path: string,
  accessKey: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request(new URL(path, baseUrl).toString(), {
    method: 'GET',
    headers: { authorization: `Bearer ${accessKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.body.text();
  if (text === '') return { status: res.statusCode, body: null };
  try {
    return { status: res.statusCode, body: JSON.parse(text) as unknown };
  } catch {
    return { status: res.statusCode, body: null };
  }
}

/** Verify the stored key against inwit and fetch the topic list in one call. */
export async function testInwitConfig(userId: string): Promise<InwitTestResponse> {
  const { baseUrl, accessKey } = await requireInwitAccessKey(userId);
  let res: { status: number; body: unknown };
  try {
    res = await inwitGetJson(baseUrl, '/api/topics', accessKey);
  } catch (err) {
    logger.warn('inwit.test_unreachable', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw AppError.of(502, 'INWIT_UNREACHABLE');
  }
  if (res.status === 401) throw AppError.of(401, 'INWIT_KEY_INVALID');
  if (res.status === 403) throw AppError.of(403, 'INWIT_KEY_FORBIDDEN');
  if (res.status !== 200) throw AppError.of(502, 'INWIT_UNREACHABLE');
  const items = Array.isArray((res.body as { items?: unknown }).items)
    ? ((res.body as { items: unknown[] }).items as Array<Record<string, unknown>>)
    : [];
  return {
    ok: true,
    topics: items
      .filter((item) => typeof item.id === 'string' && typeof item.title === 'string')
      .map((item) => ({ id: item.id as string, title: item.title as string })),
  };
}
