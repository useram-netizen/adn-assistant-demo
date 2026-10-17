import { Router } from 'express';
import type { Config } from '../config/env.js';
import type { EventRecord, Store } from '../domain/types.js';
import { eventsBody } from '../events/schemas.js';
import { log } from '../lib/log.js';
import { FixedWindowCounter, RATE_LIMITS, rateLimit } from '../security/rateLimit.js';
import { sendValidationError } from './validate.js';

export interface EventsRouterDeps {
  config: Config;
  store: Pick<Store, 'saveEvents'>;
  /** False only with RATE_LIMITS=off (end-to-end tests). */
  rateLimitEnabled: boolean;
}

/** One conversation is a few dozen events; past this many in six hours a session is not one. */
const MAX_EVENTS_PER_SESSION = 400;
const SESSION_WINDOW_MS = 6 * 60 * 60_000;

/** A visitor's clock can be wrong: events more than a week off are dated by the server instead. */
const MAX_CLOCK_SKEW_MS = 7 * 24 * 60 * 60_000;

/**
 * POST /events { sessionId, site, events: [{ type, data, at }] } → 204 (mounted under /api).
 * The whole batch is rejected if any event has the wrong shape. Events hold option values and
 * counts only; nothing typed by the visitor is accepted (see events/schemas.ts).
 */
export function eventsRouter({ config, store, rateLimitEnabled }: EventsRouterDeps): Router {
  const router = Router();
  const limiter = rateLimit({
    name: 'events',
    ...RATE_LIMITS.events,
    platform: config.platform,
    enabled: rateLimitEnabled,
  });
  // A session id is chosen by the client, so this only stops one session from filling the log;
  // the per-address limit above is what stops someone making up sessions.
  const perSession = new FixedWindowCounter(SESSION_WINDOW_MS, MAX_EVENTS_PER_SESSION);

  router.post('/events', limiter, async (req, res) => {
    const parsed = eventsBody.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { sessionId, site, events } = parsed.data;
    const now = new Date();

    if (rateLimitEnabled) {
      let allowed = true;
      for (let i = 0; i < events.length; i += 1) allowed = perSession.hit(sessionId).allowed;
      // Quietly ignored: tracking must never get in the way of anyone.
      if (!allowed) return void res.status(204).end();
    }

    const records = events.map((event): EventRecord => {
      const claimed = Date.parse(event.at);
      const at = Math.abs(claimed - now.getTime()) <= MAX_CLOCK_SKEW_MS ? new Date(claimed) : now;
      return {
        sessionId,
        site,
        type: event.type,
        data: event.data,
        at: at.toISOString(),
        receivedAt: now.toISOString(),
        source: 'client',
      };
    });

    try {
      await store.saveEvents(records);
    } catch (error) {
      // Tracking must never get in the visitor's way.
      log.error('events_save_failed', { code: error instanceof Error ? error.name : 'unknown' });
    }
    res.status(204).end();
  });

  return router;
}
