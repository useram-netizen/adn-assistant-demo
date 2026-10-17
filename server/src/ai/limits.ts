/**
 * MAX_AI_CALLS_PER_SESSION, kept in memory (one server instance). Sessions are forgotten after
 * SESSION_TTL_MS, and at most `maxSessions` are tracked, so the map can't grow without bound.
 * A forgotten session simply starts a new budget; the per-IP limit still applies.
 */

/** Long enough for any real visit. */
export const SESSION_TTL_MS = 6 * 60 * 60_000;
export const MAX_TRACKED_SESSIONS = 20_000;

export interface SessionBudgetOptions {
  ttlMs?: number;
  maxSessions?: number;
  now?: () => number;
}

export class SessionBudget {
  private readonly sessions = new Map<string, { used: number; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;

  constructor(
    private readonly maxCalls: number,
    { ttlMs = SESSION_TTL_MS, maxSessions = MAX_TRACKED_SESSIONS, now = Date.now }: SessionBudgetOptions = {},
  ) {
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.now = now;
  }

  /** True while the session has AI calls left. */
  hasRoom(sessionId: string): boolean {
    return this.used(sessionId) < this.maxCalls;
  }

  /** Counts one AI call for the session. */
  take(sessionId: string): void {
    const now = this.now();
    const entry = this.sessions.get(sessionId);
    if (entry && entry.expiresAt > now) {
      entry.used += 1;
      return;
    }
    this.sessions.delete(sessionId);
    if (this.sessions.size >= this.maxSessions) this.evict(now);
    this.sessions.set(sessionId, { used: 1, expiresAt: now + this.ttlMs });
  }

  /** How many sessions are tracked (for tests). */
  get size(): number {
    return this.sessions.size;
  }

  private used(sessionId: string): number {
    const entry = this.sessions.get(sessionId);
    return entry && entry.expiresAt > this.now() ? entry.used : 0;
  }

  /** Drops expired sessions; if that frees nothing, drops the oldest (Maps keep insertion order). */
  private evict(now: number): void {
    for (const [id, entry] of this.sessions) {
      if (entry.expiresAt <= now) this.sessions.delete(id);
    }
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next();
      if (oldest.done) break;
      this.sessions.delete(oldest.value);
    }
  }
}
