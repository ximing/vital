import { isIP } from 'node:net';
import { AppError } from '../errors.js';

const MAX_HOPS = 3;

/** Browser-like UA so origin servers return article HTML, not a bot wall. */
export const EXTRACT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export const EXTRACT_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = MAX_HOPS;

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  const d = parts[3] ?? 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n >>> 24 === 0) return true; // 0.0.0.0/8
  if (n >>> 24 === 127) return true; // 127.0.0.0/8
  if (n >>> 24 === 10) return true; // 10.0.0.0/8
  if (n >>> 20 === 0xac1) return true; // 172.16.0.0/12
  if (n >>> 16 === 0xc0a8) return true; // 192.168.0.0/16
  if (n >>> 16 === 0xa9fe) return true; // 169.254.0.0/16
  if (n >>> 22 === 0x191) return true; // 100.64.0.0/10
  return false;
}

function expandIpv6(ip: string): number[] {
  const bare = ip.split('%')[0] ?? ip;
  const lower = bare.toLowerCase();
  const [head, tail] = lower.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = Math.max(8 - headParts.length - tailParts.length, 0);
  const parts = [...headParts, ...Array.from({ length: missing }, () => '0'), ...tailParts];
  while (parts.length < 8) parts.push('0');
  return parts.slice(0, 8).map((p) => {
    if (p.includes('.')) return 0;
    const n = Number.parseInt(p, 16);
    return Number.isFinite(n) ? n : 0;
  });
}

function mappedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const rest = lower.slice('::ffff:'.length);
    if (isIP(rest) === 4) return rest;
  }
  if (isIP(ip) !== 6) return null;
  const parts = expandIpv6(ip);
  const z0 = parts[0] ?? 0;
  const z1 = parts[1] ?? 0;
  const z2 = parts[2] ?? 0;
  const z3 = parts[3] ?? 0;
  const z4 = parts[4] ?? 0;
  const z5 = parts[5] ?? 0;
  const z6 = parts[6] ?? 0;
  const z7 = parts[7] ?? 0;
  if (z0 === 0 && z1 === 0 && z2 === 0 && z3 === 0 && z4 === 0 && z5 === 0xffff) {
    const a = (z6 >> 8) & 0xff;
    const b = z6 & 0xff;
    const c = (z7 >> 8) & 0xff;
    const d = z7 & 0xff;
    return `${String(a)}.${String(b)}.${String(c)}.${String(d)}`;
  }
  return null;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  const v4 = mappedV4(ip);
  if (v4) return isPrivateV4(v4);
  const parts = expandIpv6(ip);
  const first = parts[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !isPrivateV4(ip);
  if (kind === 6) return !isPrivateV6(ip);
  return false;
}

/** Non-canonical IPv4 (decimal/hex/octal/short) must not reach DNS. */
export function isNonCanonicalIpLiteral(host: string): boolean {
  if (isIP(host) !== 0) return false;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^\d+$/.test(host)) return true;
  if (/^[0-9a-fx.]+$/i.test(host) && host.includes('.')) return true;
  return false;
}

export function hostnameOf(url: URL): string {
  let host = url.hostname.replace(/\.$/, '').toLowerCase();
  // Node 22+ WHATWG URL keeps brackets on IPv6 hostnames.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host;
}

export function assertSafeUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const host = hostnameOf(url);
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (isNonCanonicalIpLiteral(host)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (isIP(host) !== 0 && !isPublicIp(host)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
}

export function assertPublicAddress(address: string): void {
  if (!isPublicIp(address)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
}

export function resolveRedirect(current: URL, location: string): URL {
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  assertSafeUrl(next);
  return next;
}

export { MAX_HOPS };
