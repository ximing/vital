import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { isTrustedProxy, parseTrustList } from '../src/plugins/trust-proxy.js';

describe('isTrustedProxy', () => {
  it('trusts loopback CIDR 127.0.0.0/8 and ::1', () => {
    expect(isTrustedProxy('127.0.0.1')).toBe(true);
    expect(isTrustedProxy('127.1.2.3')).toBe(true);
    expect(isTrustedProxy('::1')).toBe(true);
    expect(isTrustedProxy('::ffff:127.0.0.1')).toBe(true);
  });

  it('trusts docker bridge 172.16.0.0/12', () => {
    expect(isTrustedProxy('172.16.0.1')).toBe(true);
    expect(isTrustedProxy('172.17.0.1')).toBe(true);
    expect(isTrustedProxy('172.31.255.254')).toBe(true);
    expect(isTrustedProxy('::ffff:172.17.0.1')).toBe(true);
  });

  it('trusts the default extra entry nginx 39.96.159.212', () => {
    expect(isTrustedProxy('39.96.159.212')).toBe(true);
    expect(isTrustedProxy('::ffff:39.96.159.212')).toBe(true);
  });

  it('trusts extra CIDRs passed as the second argument', () => {
    expect(isTrustedProxy('10.1.2.3', '10.0.0.0/8,192.168.0.0/16')).toBe(true);
    expect(isTrustedProxy('192.168.9.9', '10.0.0.0/8,192.168.0.0/16')).toBe(true);
    expect(isTrustedProxy('11.0.0.1', '10.0.0.0/8')).toBe(false);
  });

  it('rejects other addresses', () => {
    expect(isTrustedProxy('172.15.255.255')).toBe(false);
    expect(isTrustedProxy('172.32.0.1')).toBe(false);
    expect(isTrustedProxy('10.0.0.1')).toBe(false);
    expect(isTrustedProxy('192.168.1.1')).toBe(false);
    expect(isTrustedProxy('203.0.113.9')).toBe(false);
    expect(isTrustedProxy('8.8.8.8')).toBe(false);
  });

  it('parseTrustList skips blanks and junk', () => {
    expect(parseTrustList(' 39.96.159.212 , not-an-ip, 10.0.0.0/8 ')).toEqual([
      { kind: 'exact', exact: '39.96.159.212' },
      { kind: 'cidr4', net: 0x0a000000, mask: 0xff000000 },
    ]);
  });
});

describe('trustProxy req.ip', () => {
  it('uses X-Forwarded-For when remoteAddress is the entry nginx', async () => {
    const app = Fastify({ logger: false, trustProxy: isTrustedProxy });
    app.get('/ip', (req) => ({ ip: req.ip }));
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '39.96.159.212',
      headers: { 'x-forwarded-for': '203.0.113.50' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ip).toBe('203.0.113.50');
    await app.close();
  });

  it('ignores X-Forwarded-For from an untrusted remoteAddress', async () => {
    const app = Fastify({ logger: false, trustProxy: isTrustedProxy });
    app.get('/ip', (req) => ({ ip: req.ip }));
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '8.8.8.8',
      headers: { 'x-forwarded-for': '203.0.113.50' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ip).toBe('8.8.8.8');
    await app.close();
  });
});
