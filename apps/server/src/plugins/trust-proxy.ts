import { isIP } from 'node:net';
import { config } from '../config.js';

function mappedIPv4(address: string): string {
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  const c = Number(parts[2]);
  const d = Number(parts[3]);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export type TrustEntry =
  | { kind: 'cidr4'; net: number; mask: number }
  | { kind: 'exact'; exact: string };

/**
 * Loopback + Docker userland-proxy gateway. Host nginx → published
 * 127.0.0.1:3010 is rewritten; the container sees 172.16.0.0/12, not loopback.
 */
export const DEFAULT_TRUST_PROXY_CIDRS = ['127.0.0.0/8', '172.16.0.0/12'] as const;

function parseCidr4(entry: string): TrustEntry | null {
  const slash = entry.indexOf('/');
  if (slash === -1) return null;
  const ip = entry.slice(0, slash);
  const prefix = Number(entry.slice(slash + 1));
  if (isIP(ip) !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { kind: 'cidr4', net: ipv4ToInt(ip) & mask, mask };
}

export function parseTrustList(raw: string): TrustEntry[] {
  const out: TrustEntry[] = [];
  for (const token of raw.split(',')) {
    const entry = token.trim();
    if (entry === '') continue;
    const cidr = parseCidr4(entry);
    if (cidr) {
      out.push(cidr);
      continue;
    }
    if (isIP(entry) !== 0) {
      out.push({ kind: 'exact', exact: mappedIPv4(entry) });
    }
  }
  return out;
}

const defaultEntries: TrustEntry[] = parseTrustList(DEFAULT_TRUST_PROXY_CIDRS.join(','));
const extraFromConfig: TrustEntry[] = parseTrustList(config.TRUST_PROXY_EXTRA);

function matches(address: string, entries: readonly TrustEntry[]): boolean {
  const host = mappedIPv4(address);
  if (host === '::1' || address === '::1') return true;
  const v4 = isIP(host) === 4 ? ipv4ToInt(host) : null;
  for (const entry of entries) {
    if (entry.kind === 'exact' && entry.exact === host) return true;
    if (entry.kind === 'cidr4' && v4 !== null && (v4 & entry.mask) === entry.net) return true;
  }
  return false;
}

/**
 * Never `trustProxy: true` — that would honor spoofed X-Forwarded-For from the internet.
 * Fastify calls this as `(address, hop)`; tests may pass extra CIDRs as the 2nd arg.
 */
export function isTrustedProxy(address: string, hopOrExtra?: number | string): boolean {
  const extra =
    typeof hopOrExtra === 'string' ? parseTrustList(hopOrExtra) : extraFromConfig;
  return matches(address, defaultEntries) || matches(address, extra);
}
