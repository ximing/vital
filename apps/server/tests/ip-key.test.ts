import { describe, expect, it } from 'vitest';
import { ipKey } from '../src/plugins/rate-limit.js';

describe('ipKey', () => {
  it('leaves IPv4 unchanged', () => {
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
  });

  it('strips IPv4-mapped IPv6', () => {
    expect(ipKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('masks IPv6 to /56', () => {
    expect(ipKey('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:0db8:85a3:0800::');
  });
});
