import { describe, expect, it } from 'vitest';
import {
  assertPublicAddress,
  assertSafeUrl,
  isNonCanonicalIpLiteral,
  isPublicIp,
  resolveRedirect,
} from '../../src/extract/ssrf.js';

function url(raw: string): URL {
  return new URL(raw);
}

function expectBlocked(fn: () => void): void {
  expect(fn).toThrow();
}

describe('SSRF URL + IP guards', () => {
  it('rejects file/gopher/data even as a URL', () => {
    expectBlocked(() => {
      assertSafeUrl(url('file:///etc/passwd'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('gopher://127.0.0.1/'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('data:text/html,hi'));
    });
  });

  it('rejects localhost hostname', () => {
    expectBlocked(() => {
      assertSafeUrl(url('http://localhost/'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('http://LOCALHOST/x'));
    });
  });

  it('rejects loopback, RFC1918, link-local, CGNAT, unspecified', () => {
    expect(isPublicIp('0.0.0.1')).toBe(false);
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('10.1.2.3')).toBe(false);
    expect(isPublicIp('172.16.0.1')).toBe(false);
    expect(isPublicIp('172.31.255.255')).toBe(false);
    expect(isPublicIp('192.168.1.1')).toBe(false);
    expect(isPublicIp('169.254.169.254')).toBe(false);
    expect(isPublicIp('100.64.0.1')).toBe(false);
    expect(isPublicIp('1.1.1.1')).toBe(true);
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expectBlocked(() => {
      assertSafeUrl(url('http://127.0.0.1/'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('http://169.254.169.254/latest/'));
    });
  });

  it('rejects ::1, unique-local, link-local IPv6', () => {
    expect(isPublicIp('::1')).toBe(false);
    expect(isPublicIp('fc00::1')).toBe(false);
    expect(isPublicIp('fd12:3456:789a::1')).toBe(false);
    expect(isPublicIp('fe80::1')).toBe(false);
    expect(isPublicIp('2001:4860:4860::8888')).toBe(true);
    expectBlocked(() => {
      assertSafeUrl(url('http://[::1]/'));
    });
  });

  it('rejects IPv4-mapped IPv6 private addresses', () => {
    expect(isPublicIp('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIp('::ffff:10.0.0.1')).toBe(false);
    expect(isPublicIp('::ffff:192.168.0.1')).toBe(false);
    expect(isPublicIp('::ffff:7f00:1')).toBe(false);
    expect(isPublicIp('::ffff:8.8.8.8')).toBe(true);
    expectBlocked(() => {
      assertSafeUrl(url('http://[::ffff:127.0.0.1]/'));
    });
    expectBlocked(() => {
      assertPublicAddress('::ffff:169.254.169.254');
    });
  });

  it('rejects decimal/hex/octal IPv4 forms', () => {
    expect(isNonCanonicalIpLiteral('2130706433')).toBe(true);
    expect(isNonCanonicalIpLiteral('0x7f000001')).toBe(true);
    expect(isNonCanonicalIpLiteral('0177.0.0.1')).toBe(true);
    expect(isNonCanonicalIpLiteral('127.1')).toBe(true);
    expect(isNonCanonicalIpLiteral('0x7f.0.0.1')).toBe(true);
    expect(isNonCanonicalIpLiteral('example.com')).toBe(false);
    expectBlocked(() => {
      assertSafeUrl(url('http://2130706433/'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('http://0x7f000001/'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('http://0177.0.0.1/'));
    });
  });

  it('rejects NAT64, 6to4 with a private embedded IPv4, and multicast', () => {
    expect(isPublicIp('64:ff9b::')).toBe(false);
    expect(isPublicIp('64:ff9b::808:808')).toBe(false);
    expect(isPublicIp('64:ff9b:1::')).toBe(false);
    expect(isPublicIp('64:ff9b:1:2::3')).toBe(false);
    expect(isPublicIp('2002:7f00:1::')).toBe(false);
    expect(isPublicIp('2002:a9fe:a9fe::')).toBe(false);
    expect(isPublicIp('2002:808:808::')).toBe(true);
    expect(isPublicIp('224.0.0.1')).toBe(false);
    expect(isPublicIp('239.255.255.255')).toBe(false);
    expect(isPublicIp('240.0.0.1')).toBe(false);
    expect(isPublicIp('255.255.255.255')).toBe(false);
    expect(isPublicIp('ff00::1')).toBe(false);
    expect(isPublicIp('ff02::1')).toBe(false);
    expect(isPublicIp('::ffff:224.0.0.1')).toBe(false);
    expectBlocked(() => {
      assertSafeUrl(url('http://[64:ff9b::1]/'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('http://[2002:7f00:1::]/'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('http://224.0.0.1/'));
    });
    expectBlocked(() => {
      assertSafeUrl(url('http://[ff02::1]/'));
    });
    expect(isPublicIp('1.1.1.1')).toBe(true);
    assertSafeUrl(url('http://[2002:808:808::]/'));
  });

  it('re-checks each redirect hop including file: after https', () => {
    const current = url('https://example.com/a');
    expectBlocked(() => {
      resolveRedirect(current, 'file:///etc/passwd');
    });
    expectBlocked(() => {
      resolveRedirect(current, 'http://127.0.0.1/');
    });
    expectBlocked(() => {
      resolveRedirect(current, 'gopher://x');
    });
    expectBlocked(() => {
      resolveRedirect(current, 'data:text/html,x');
    });
    const next = resolveRedirect(current, 'https://example.net/b');
    expect(next.href).toBe('https://example.net/b');
  });
});
