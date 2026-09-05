import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { MAX_EXTRACT_HTML_BYTES } from '@vital/dto';
import { Agent, request } from 'undici';
import { AppError } from '../errors.js';
import { ObjectTooLargeError, readBodyWithLimit } from '../storage/bounded-read.js';
import {
  EXTRACT_TIMEOUT_MS,
  EXTRACT_USER_AGENT,
  MAX_REDIRECTS,
  assertPublicAddress,
  assertSafeUrl,
  hostnameOf,
  resolveRedirect,
} from './ssrf.js';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedHttpResponse {
  statusCode: number;
  location: string | undefined;
  contentType: string | undefined;
  body: Buffer;
}

export interface ExtractTransport {
  lookup(hostname: string, signal?: AbortSignal): Promise<ResolvedAddress>;
  request(
    url: URL,
    pinned: ResolvedAddress,
    signal: AbortSignal,
  ): Promise<PinnedHttpResponse>;
}

function abortError(): AppError {
  return AppError.of(400, 'VALIDATION_ERROR');
}

/** DNS/connect work must die with the extract AbortSignal, not the OS resolver timeout. */
function raceAbort<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        reject(err instanceof Error ? err : abortError());
      },
    );
  });
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

function familyOf(address: string): 4 | 6 {
  return isIP(address) === 6 ? 6 : 4;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

const defaultTransport: ExtractTransport = {
  async lookup(hostname: string, _signal?: AbortSignal): Promise<ResolvedAddress> {
    const result = await dnsLookup(hostname, { verbatim: true });
    const family: 4 | 6 = result.family === 6 ? 6 : 4;
    return { address: result.address, family };
  },
  async request(
    url: URL,
    pinned: ResolvedAddress,
    signal: AbortSignal,
  ): Promise<PinnedHttpResponse> {
    // Pin connect to the already-checked address; do not re-resolve (DNS rebinding).
    const dispatcher = new Agent({
      connect: {
        lookup(_hostname, options, callback) {
          if (options.all === true) {
            callback(null, [{ address: pinned.address, family: pinned.family }]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
      },
      connectTimeout: EXTRACT_TIMEOUT_MS,
      headersTimeout: EXTRACT_TIMEOUT_MS,
      bodyTimeout: EXTRACT_TIMEOUT_MS,
    });
    try {
      const res = await request(url.href, {
        dispatcher,
        method: 'GET',
        maxRedirections: 0,
        signal,
        headersTimeout: EXTRACT_TIMEOUT_MS,
        bodyTimeout: EXTRACT_TIMEOUT_MS,
        headers: {
          'user-agent': EXTRACT_USER_AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
      });
      let body: Buffer;
      try {
        body = await readBodyWithLimit(res.body, MAX_EXTRACT_HTML_BYTES, url.href);
      } catch (err) {
        if (err instanceof ObjectTooLargeError) throw AppError.of(400, 'VALIDATION_ERROR');
        throw err;
      }
      return {
        statusCode: res.statusCode,
        location: headerValue(res.headers.location),
        contentType: headerValue(res.headers['content-type']),
        body,
      };
    } finally {
      await dispatcher.close();
    }
  },
};

let transport: ExtractTransport = defaultTransport;

/** Test seam. Do not call from product code. */
export function setExtractTransport(next: ExtractTransport | null): void {
  transport = next ?? defaultTransport;
}

export async function lookupPinned(
  hostname: string,
  signal: AbortSignal,
): Promise<ResolvedAddress> {
  if (signal.aborted) throw abortError();
  if (isIP(hostname) !== 0) {
    assertPublicAddress(hostname);
    return { address: hostname, family: familyOf(hostname) };
  }
  const resolved = await raceAbort(signal, transport.lookup(hostname, signal));
  assertPublicAddress(resolved.address);
  return resolved;
}

export async function fetchHtml(rawUrl: string, timeoutMs = EXTRACT_TIMEOUT_MS): Promise<{
  url: URL;
  html: string;
}> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  assertSafeUrl(url);

  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      assertSafeUrl(url);
      const pinned = await lookupPinned(hostnameOf(url), ac.signal);
      if (ac.signal.aborted) throw abortError();
      const res = await transport.request(url, pinned, ac.signal);
      if (REDIRECT.has(res.statusCode)) {
        if (hop === MAX_REDIRECTS || res.location === undefined || res.location === '') {
          throw AppError.of(400, 'VALIDATION_ERROR');
        }
        url = resolveRedirect(url, res.location);
        continue;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw AppError.of(400, 'VALIDATION_ERROR');
      }
      const contentType = (res.contentType ?? '').toLowerCase();
      if (
        contentType !== '' &&
        !contentType.includes('html') &&
        !contentType.includes('xml') &&
        !contentType.includes('text/plain')
      ) {
        throw AppError.of(400, 'VALIDATION_ERROR');
      }
      return { url, html: res.body.toString('utf8') };
    }
    throw AppError.of(400, 'VALIDATION_ERROR');
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.of(400, 'VALIDATION_ERROR');
  } finally {
    clearTimeout(timer);
  }
}
