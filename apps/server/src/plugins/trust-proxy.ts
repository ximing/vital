import { isIP } from 'node:net';

function mappedIPv4(address: string): string {
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

/**
 * Host nginx → published 127.0.0.1:3010 is rewritten by Docker's userland proxy;
 * the container sees the bridge gateway (172.16.0.0/12), not loopback.
 * Never `trustProxy: true` — that would honor spoofed X-Forwarded-For from the internet.
 */
export function isTrustedProxy(address: string): boolean {
  if (address === '::1') return true;
  const host = mappedIPv4(address);
  if (host === '127.0.0.1') return true;
  if (isIP(host) !== 4) return false;
  const parts = host.split('.');
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return a === 172 && b >= 16 && b <= 31;
}
