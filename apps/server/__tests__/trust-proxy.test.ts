import { describe, expect, it } from 'vitest';
import { isTrustedProxy } from '../src/plugins/trust-proxy.js';

describe('isTrustedProxy', () => {
  it('trusts loopback', () => {
    expect(isTrustedProxy('127.0.0.1')).toBe(true);
    expect(isTrustedProxy('::1')).toBe(true);
    expect(isTrustedProxy('::ffff:127.0.0.1')).toBe(true);
  });

  it('trusts docker bridge 172.16.0.0/12', () => {
    expect(isTrustedProxy('172.16.0.1')).toBe(true);
    expect(isTrustedProxy('172.17.0.1')).toBe(true);
    expect(isTrustedProxy('172.31.255.254')).toBe(true);
    expect(isTrustedProxy('::ffff:172.17.0.1')).toBe(true);
  });

  it('rejects other addresses', () => {
    expect(isTrustedProxy('172.15.255.255')).toBe(false);
    expect(isTrustedProxy('172.32.0.1')).toBe(false);
    expect(isTrustedProxy('10.0.0.1')).toBe(false);
    expect(isTrustedProxy('192.168.1.1')).toBe(false);
    expect(isTrustedProxy('203.0.113.9')).toBe(false);
    expect(isTrustedProxy('8.8.8.8')).toBe(false);
  });
});
