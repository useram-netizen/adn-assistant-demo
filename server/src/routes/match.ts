import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config/env.js';
import {
  ANY_SUBTYPE,
  CATEGORY_KEYS,
  TIERS,
  isSubtypeOf,
  type CategoryKey,
} from '../config/taxonomy.js';
import type { EventSink, Geo, MatchInput, MemberDirectory, Store } from '../domain/types.js';
import { log } from '../lib/log.js';
import { toCard } from '../members/cards.js';
import { RATE_LIMITS, rateLimit } from '../security/rateLimit.js';
import type { MatchResponse } from '../shared/api.js';
import { sendValidationError, sessionIdSchema, siteSchema, stateSchema } from './validate.js';

export interface MatchRouterDeps {
  config: Config;
  geo: Geo;
  directory: MemberDirectory;
  store: Store;
  events: EventSink;
  /** False only with RATE_LIMITS=off (end-to-end tests). */
  rateLimitEnabled: boolean;
}

/**
 * POST /match → { results, total, noMatch, counts } (mounted under /api). State, county,
 * category and subcategory are checked against the real lists (rule 3). Results are in order:
 * Platinum, Gold, Silver, each tier shuffled by the session ID. A search with no result saves
 * a gap record (never failing the request if the save fails).
 */
export function matchRouter({
  config,
  geo,
  directory,
  store,
  events,
  rateLimitEnabled,
}: MatchRouterDeps): Router {
  const router = Router();
  const limiter = rateLimit({
    name: 'match',
    ...RATE_LIMITS.match,
    platform: config.platform,
    enabled: rateLimitEnabled,
  });

  const body = z
    .object({
      sessionId: sessionIdSchema,
      site: siteSchema,
      state: stateSchema(geo),
      countyFips: z.string().regex(/^\d{5}$/),
      category: z.enum(CATEGORY_KEYS),
      subcategory: z.string().nullish(),
    })
    .superRefine((value, ctx) => {
      const county = geo.county(value.countyFips);
      if (!county || county.state !== value.state) {
        ctx.addIssue({
          code: 'custom',
          path: ['countyFips'],
          message: 'not a county of the state',
        });
      }
      const { subcategory } = value;
      if (subcategory && subcategory !== ANY_SUBTYPE && !isSubtypeOf(value.category, subcategory)) {
        ctx.addIssue({ code: 'custom', path: ['subcategory'], message: 'not a subtype' });
      }
    });

  router.post('/match', limiter, async (req, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { sessionId, site, state, countyFips, category } = parsed.data;
    const subcategory =
      parsed.data.subcategory && parsed.data.subcategory !== ANY_SUBTYPE
        ? parsed.data.subcategory
        : null;

    const input: MatchInput = { state, countyFips, category, subcategory };
    const matched = directory.match(input, sessionId);
    const counts = Object.fromEntries(TIERS.map((tier) => [tier, 0])) as MatchResponse['counts'];
    for (const member of matched) if (member.tier) counts[member.tier] += 1;

    if (matched.length === 0) await saveGap(store, geo, site, input, category);
    recordSearch(events, {
      sessionId,
      site,
      state,
      countyFips,
      category,
      counts,
      total: matched.length,
    });

    const response: MatchResponse = {
      results: matched.map((member) => toCard(member, input, geo, config.showProContact)),
      total: matched.length,
      noMatch: matched.length === 0,
      counts,
    };
    res.json(response);
  });

  return router;
}

async function saveGap(
  store: Store,
  geo: Geo,
  site: string,
  input: MatchInput,
  category: CategoryKey,
): Promise<void> {
  try {
    await store.saveGap({
      createdAt: new Date().toISOString(),
      site,
      state: input.state,
      countyFips: input.countyFips,
      county: geo.county(input.countyFips)?.name ?? input.countyFips,
      category,
      subcategory: input.subcategory,
    });
  } catch (error) {
    // A gap that can't be saved must never stop the visitor reaching the no-match screen.
    log.error('gap_save_failed', { code: error instanceof Error ? error.name : 'unknown' });
  }
}

/** Usage events for a search, from the real result (so they can't be made up from outside). */
function recordSearch(
  events: EventSink,
  search: {
    sessionId: string;
    site: string;
    state: string;
    countyFips: string;
    category: CategoryKey;
    counts: MatchResponse['counts'];
    total: number;
  },
): void {
  try {
    const { sessionId, site, state, countyFips, category, counts, total } = search;
    if (total === 0) {
      events.record({ sessionId, site, type: 'no_match', data: { category, state, countyFips } });
    } else {
      events.record({
        sessionId,
        site,
        type: 'results_shown',
        data: { ...counts, total, category, state },
      });
    }
  } catch (error) {
    log.error('event_record_failed', { error: error instanceof Error ? error.name : 'unknown' });
  }
}
