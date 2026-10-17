import { isIPv4, isIPv6 } from 'node:net';
import type { Request, RequestHandler } from 'express';
import type { Config } from '../config/env.js';
import { log } from '../lib/log.js';

/** Expands an IPv6 address into its eight 16-bit groups (as numbers); null if it is not one. */
function ipv6Groups(address: string): number[] | null {
  if (!isIPv6(address)) return null;
  let text = address;
  // A dotted IPv4 tail ("::ffff:1.2.3.4") is two more groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [, a, b, c, d] = tail.map(Number);
    text =
      text.slice(0, tail.index) +
      `${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const first = head ? head.split(':') : [];
  const last = rest === undefined ? [] : rest ? rest.split(':') : [];
  const fill = rest === undefined ? 0 : 8 - first.length - last.length;
  const groups = [...first, ...Array<string>(Math.max(0, fill)).fill('0'), ...last];
  return groups.length === 8 ? groups.map((group) => Number.parseInt(group, 16)) : null;
}

/**
 * The address used as a rate-limit key. A person on IPv6 gets a whole /64 of addresses from their
 * provider, so those count as one visitor (otherwise a limit per address is no limit); an IPv4
 * address inside an IPv6 one counts as that IPv4 address.
 */
export function limitKey(address: string): string {
  const clean = address.trim().replace(/%.*$/, '').toLowerCase();
  if (isIPv4(clean)) return clean;
  const groups = ipv6Groups(clean);
  if (!groups) return clean || 'unknown';
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  }
  return `v6:${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}`;
}

/**
 * The visitor's IP, used only as a rate-limit key (never logged).
 * On Render, requests pass through Cloudflare, which sets CF-Connecting-IP to the real client
 * address and replaces any value the client sent. Without that header (or with something that is
 * not an address) the last X-Forwarded-For entry is used: the one Render's own proxy added,
 * which a client cannot choose, unlike the first. Elsewhere, req.ip follows TRUST_PROXY.
 */
export function clientIp(req: Request, platform: Config['platform']): string {
  if (platform === 'render') {
    const header = req.headers['cf-connecting-ip'];
    const value = typeof header === 'string' ? header.trim() : '';
    if (isIPv4(value) || isIPv6(value)) return limitKey(value);
    const forwarded = req.headers['x-forwarded-for'];
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
      .split(',')
      .at(-1)
      ?.trim();
    if (last && (isIPv4(last) || isIPv6(last))) return limitKey(last);
    return limitKey(req.socket.remoteAddress ?? 'unknown');
  }
  return limitKey(req.ip ?? req.socket.remoteAddress ?? 'unknown');
}

/** More addresses than this are never remembered at once, whatever the flood. */
const MAX_KEYS = 50_000;
/** Expired windows are swept at most this often (a sweep visits every key). */
const SWEEP_EVERY_MS = 5_000;

/** A fixed-window counter per key, kept in memory (one server instance). */
export class FixedWindowCounter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit. `allowed` is false once the key went over `max` in this window. */
  hit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
      this.sweep(now);
    }
    window.count += 1;
    return {
      allowed: window.count <= this.max,
      remaining: Math.max(0, this.max - window.count),
      resetAt: window.resetAt,
    };
  }

  /** True once the key has used up its hits in this window (without counting another). */
  blocked(key: string): boolean {
    const window = this.windows.get(key);
    return Boolean(window && window.resetAt > this.now() && window.count >= this.max);
  }

  /**
   * Keeps memory and time bounded: expired windows go at most every few seconds, and if a
   * flood still leaves too many, the oldest are dropped (they simply start a fresh window).
   */
  private sweep(now: number): void {
    if (this.windows.size < MAX_KEYS && now - this.lastSweep < SWEEP_EVERY_MS) return;
    if (now - this.lastSweep >= SWEEP_EVERY_MS || this.windows.size > MAX_KEYS) {
      this.lastSweep = now;
      for (const [key, window] of this.windows) {
        if (window.resetAt <= now) this.windows.delete(key);
      }
    }
    let excess = this.windows.size - MAX_KEYS;
    if (excess > 0) {
      excess += Math.floor(MAX_KEYS / 10);
      for (const key of this.windows.keys()) {
        if (excess-- <= 0) break;
        this.windows.delete(key);
      }
    }
  }

  /** How many keys are being counted (for tests). */
  get size(): number {
    return this.windows.size;
  }
}

export interface RateLimitOptions {
  /** For logs, for example "ai" or "leads". */
  name: string;
  windowMs: number;
  max: number;
  platform: Config['platform'];
  /** RATE_LIMITS=off (tests only) turns every limiter off. */
  enabled?: boolean;
}

/** Spec limits per IP: AI 20/min, match 30/min, leads and the Tracy form 5/hour. */
export const RATE_LIMITS = {
  ai: { windowMs: 60_000, max: 20 },
  match: { windowMs: 60_000, max: 30 },
  leads: { windowMs: 60 * 60_000, max: 5 },
  tracy: { windowMs: 60 * 60_000, max: 5 },
  events: { windowMs: 60_000, max: 30 },
} as const;

/** Express middleware: 429 { error: "rate_limited" } with Retry-After once over the limit. */
export function rateLimit({
  name,
  windowMs,
  max,
  platform,
  enabled = true,
}: RateLimitOptions): RequestHandler {
  const counter = new FixedWindowCounter(windowMs, max);
  return (req, res, next) => {
    if (!enabled) {
      next();
      return;
    }
    const result = counter.hit(clientIp(req, platform));
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      log.warn('rate_limited', { limiter: name, path: req.path });
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  };
}

/** RATE_LIMITS=off turns the limits off (end-to-end tests run many sessions from one IP). */
export function rateLimitsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RATE_LIMITS?.trim().toLowerCase() !== 'off';
}
