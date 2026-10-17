import type { Request, RequestHandler } from 'express';
import type { Config } from '../config/env.js';
import { log } from '../lib/log.js';

/**
 * The visitor's IP, used only as a rate-limit key (never logged).
 * On Render, requests pass through Cloudflare, which sets CF-Connecting-IP to the real client
 * address and replaces any value the client sent. Elsewhere, req.ip follows TRUST_PROXY.
 */
export function clientIp(req: Request, platform: Config['platform']): string {
  if (platform === 'render') {
    const header = req.headers['cf-connecting-ip'];
    if (typeof header === 'string' && header.trim()) return header.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** A fixed-window counter per key, kept in memory (one server instance). */
export class FixedWindowCounter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

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
      if (this.windows.size > 10_000) this.prune(now);
    }
    window.count += 1;
    return {
      allowed: window.count <= this.max,
      remaining: Math.max(0, this.max - window.count),
      resetAt: window.resetAt,
    };
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
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
  events: { windowMs: 60_000, max: 120 },
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
