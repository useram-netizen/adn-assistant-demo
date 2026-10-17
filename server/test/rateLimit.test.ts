import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { FixedWindowCounter, clientIp, limitKey } from '../src/security/rateLimit.js';

const request = (headers: Record<string, string>, ip = '10.0.0.9', remote = '10.0.0.8') =>
  ({ headers, ip, socket: { remoteAddress: remote } }) as unknown as Request;

describe('limitKey', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(limitKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('counts a whole IPv6 /64 as one visitor, since a provider hands out all of it', () => {
    const one = limitKey('2001:db8:abcd:12:1111:2222:3333:4444');
    expect(limitKey('2001:db8:abcd:12:ffff:eeee:dddd:cccc')).toBe(one);
    expect(limitKey('2001:DB8:ABCD:12::1')).toBe(one);
    expect(limitKey('2001:db8:abcd:13:1111:2222:3333:4444')).not.toBe(one);
    expect(limitKey('2001:db8:abcd:0012::')).toBe(one);
  });

  it('reads an IPv4 address inside an IPv6 one as that IPv4 address', () => {
    expect(limitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(limitKey('::ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('ignores a zone id and copes with nonsense', () => {
    expect(limitKey('fe80::1%en0')).toBe(limitKey('fe80::2'));
    expect(limitKey('')).toBe('unknown');
    expect(limitKey('not an address')).toBe('not an address');
  });
});

describe('clientIp', () => {
  it('uses CF-Connecting-IP on Render (Cloudflare sets it)', () => {
    expect(clientIp(request({ 'cf-connecting-ip': '198.51.100.4' }), 'render')).toBe(
      '198.51.100.4',
    );
  });

  it('on Render, without that header, trusts only the last X-Forwarded-For entry', () => {
    // A client can send any first entry; Render's proxy adds the real one at the end.
    const spoofed = request({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 198.51.100.4' });
    expect(clientIp(spoofed, 'render')).toBe('198.51.100.4');
    const other = request({ 'x-forwarded-for': '9.9.9.9, 198.51.100.4' });
    expect(clientIp(other, 'render')).toBe('198.51.100.4');
  });

  it('on Render, ignores a CF-Connecting-IP that is not an address', () => {
    const odd = request({ 'cf-connecting-ip': 'hello', 'x-forwarded-for': '198.51.100.4' });
    expect(clientIp(odd, 'render')).toBe('198.51.100.4');
  });

  it('on Render with neither, uses the connection’s own address', () => {
    expect(clientIp(request({}, '10.0.0.9', '192.0.2.77'), 'render')).toBe('192.0.2.77');
  });

  it('elsewhere, follows what Express made of the request (TRUST_PROXY) and ignores the headers', () => {
    const req = request(
      { 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '1.2.3.4' },
      '192.0.2.5',
    );
    expect(clientIp(req, 'other')).toBe('192.0.2.5');
  });
});

describe('FixedWindowCounter', () => {
  it('allows `max` hits per window, then none, then starts again', () => {
    let now = 1_000;
    const counter = new FixedWindowCounter(60_000, 3, () => now);
    expect([1, 2, 3, 4].map(() => counter.hit('a').allowed)).toEqual([true, true, true, false]);
    expect(counter.hit('b').allowed).toBe(true);
    now += 60_000;
    expect(counter.hit('a').allowed).toBe(true);
  });

  it('never remembers more than 50,000 addresses, and stays fast under a flood of new ones', () => {
    const counter = new FixedWindowCounter(3_600_000, 5);
    const start = performance.now();
    for (let i = 0; i < 150_000; i += 1) counter.hit(`k${i}`);
    expect(performance.now() - start).toBeLessThan(3_000);
    expect(counter.size).toBeLessThanOrEqual(50_000);
  });

  it('still limits an address that keeps coming while a flood goes on', () => {
    const counter = new FixedWindowCounter(3_600_000, 5);
    let blocked = 0;
    for (let i = 0; i < 20_000; i += 1) {
      counter.hit(`flood${i}`);
      if (!counter.hit('steady').allowed) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(19_000);
  });
});
