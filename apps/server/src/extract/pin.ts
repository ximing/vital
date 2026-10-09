import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { AppError } from '../errors.js';
import { assertSafeUrl, hostnameOf, isPublicIp } from './ssrf.js';

export interface PinPolicy {
  production: boolean;
  signal?: AbortSignal;
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinLookupRecord {
  address: string;
  family: number;
}

export type PinLookup = (hostname: string) => Promise<PinLookupRecord[]>;

type ConnectLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void;

export interface PinnedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
  dispatcher: Agent;
  /** The agent `connect.lookup`. Returns only the pinned address. */
  lookup: ConnectLookup;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUS.has(status);
}

async function defaultLookup(hostname: string): Promise<PinLookupRecord[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

let lookupHost: PinLookup = defaultLookup;

/** Test seam. Do not call from product code. */
export function setPinLookup(next: PinLookup | null): void {
  lookupHost = next ?? defaultLookup;
}

function blocked(): never {
  throw AppError.of(400, 'VALIDATION_ERROR');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  throw error;
}

function familyOf(address: string): 4 | 6 {
  return isIP(address) === 6 ? 6 : 4;
}

function parseUrl(raw: string | URL): URL {
  if (raw instanceof URL) return raw;
  try {
    return new URL(raw);
  } catch {
    return blocked();
  }
}

function devPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return isIP(host) !== 0 && !isPublicIp(host);
}

function connectLookup(pinned: ResolvedAddress): ConnectLookup {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

function openPinned(url: URL, pinned: ResolvedAddress): PinnedTarget {
  const lookup = connectLookup(pinned);
  // One-shot direct agent: connect.lookup returns only the checked address.
  // The URL keeps the original hostname so TLS SNI and certificate checks use the name.
  // A fresh Agent does not consult HTTP_PROXY / HTTPS_PROXY.
  const dispatcher = new Agent({
    connect: { lookup },
  });
  return { url, address: pinned.address, family: pinned.family, dispatcher, lookup };
}

async function resolveHost(hostname: string, signal: AbortSignal | undefined): Promise<ResolvedAddress[]> {
  throwIfAborted(signal);
  let records: PinLookupRecord[];
  try {
    records = await raceAbort(signal, lookupHost(hostname));
  } catch (err) {
    throwIfAborted(signal);
    throw err;
  }
  throwIfAborted(signal);
  const resolved: ResolvedAddress[] = [];
  for (const record of records) {
    if (isIP(record.address) === 0) blocked();
    resolved.push({ address: record.address, family: familyOf(record.address) });
  }
  if (resolved.length === 0) blocked();
  return resolved;
}

function raceAbort<T>(signal: AbortSignal | undefined, work: Promise<T>): Promise<T> {
  if (signal === undefined) return work;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(abortReason(signal));
          return;
        }
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(abortReason(signal));
          return;
        }
        reject(err instanceof Error ? err : new Error('lookup failed'));
      },
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Check the target, then pin one address for this request only.
 * Policy failures throw VALIDATION_ERROR and never include a resolved address.
 */
export async function pinHttpTarget(raw: string | URL, policy: PinPolicy): Promise<PinnedTarget> {
  const url = parseUrl(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') blocked();
  if (policy.production && url.protocol !== 'https:') blocked();
  const host = hostnameOf(url);
  // Dev/test only: localhost names and non-public IP literals. A public name is never in this branch.
  if (!policy.production && devPrivateHost(host)) {
    if (isIP(host) !== 0) return openPinned(url, { address: host, family: familyOf(host) });
    const resolved = await resolveHost(host, policy.signal);
    const chosen = resolved[0];
    if (chosen === undefined) blocked();
    return openPinned(url, chosen);
  }
  assertSafeUrl(url);
  const resolved = await resolveHost(host, policy.signal);
  for (const record of resolved) {
    if (!isPublicIp(record.address)) blocked();
  }
  const chosen = resolved[0];
  if (chosen === undefined) blocked();
  return openPinned(url, chosen);
}

function requestUrl(input: RequestInfo | URL): URL {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return new URL(input.href);
    return new URL(input.url);
  } catch {
    return blocked();
  }
}

function fetchPolicy(init: RequestInit | undefined, production: boolean): PinPolicy {
  const signal = init?.signal ?? undefined;
  if (signal) return { production, signal };
  return { production };
}

/**
 * Fetch through a pinned direct dispatcher. redirect manual: a 3xx fails the call.
 * close() waits until the body ends; awaiting it before the caller reads the stream deadlocks.
 */
export async function pinnedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  policy: PinPolicy,
): Promise<Response> {
  const pinned = await pinHttpTarget(requestUrl(input), fetchPolicy(init, policy.production));
  let handedOff = false;
  try {
    // undici's fetch types disagree with the global Request/Response (duplex, bytes).
    // The runtime fetch is undici; the dispatcher is an undici-only init field.
    const fetchImpl = undiciFetch as unknown as typeof globalThis.fetch;
    const undiciInit = {
      ...(init ?? {}),
      dispatcher: pinned.dispatcher,
      redirect: 'manual' as const,
    };
    const response = await fetchImpl(input, undiciInit);
    if (isRedirectStatus(response.status)) {
      await response.body?.cancel();
      throw AppError.of(502, 'LLM_UNAVAILABLE');
    }
    handedOff = true;
    return response;
  } finally {
    if (handedOff) void pinned.dispatcher.close();
    else await pinned.dispatcher.close();
  }
}
