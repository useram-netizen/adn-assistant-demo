import { Router } from 'express';
import { z } from 'zod';
import { createStepSpecs, exactOption, INTERPRET_STEPS, whereFor } from '../ai/options.js';
import {
  NO_HINTS,
  countyFromPlace,
  interpret,
  recommendCategories,
  situation,
  type AiOutcome,
  type InterpretHints,
} from '../ai/calls.js';
import { everydayMessage, keywordInterpret } from '../ai/keywords.js';
import type { AiCallKind, AiClient } from '../ai/client.js';
import { SessionBudget } from '../ai/limits.js';
import { copy } from '../config/copy.js';
import type { Config } from '../config/env.js';
import { STAGE_KEYS, hasSubtypes, type CategoryKey } from '../config/taxonomy.js';
import { CATEGORY_KEYS } from '../config/taxonomy.js';
import type { EventSink, Geo } from '../domain/types.js';
import { log } from '../lib/log.js';
import { matchesSafetyKeywords } from '../safety/keywords.js';
import { FixedWindowCounter, RATE_LIMITS, clientIp } from '../security/rateLimit.js';
import { STEP_IDS } from '../shared/api.js';
import type {
  CountyFromPlaceResponse,
  InterpretResponse,
  RecommendResponse,
  SituationResponse,
} from '../shared/api.js';
import {
  sendValidationError,
  sessionIdSchema,
  siteSchema,
  stateSchema,
  visitorTextSchema,
} from './validate.js';

export interface AiRouterDeps {
  config: Config;
  geo: Geo;
  events: EventSink;
  /** null when the AI is off or there is no key: every route then uses its fallback. */
  client: AiClient | null;
  /** False only with RATE_LIMITS=off (end-to-end tests). */
  rateLimitEnabled: boolean;
}

/** The text says it is a county ("Cobb County", "Orleans Parish"), not a city of the same name. */
const COUNTY_WORD = /\b(county|parish|borough|census area)\b/i;

/** A ceiling for the whole server (calls per minute), as a backstop against runaway costs. */
const GLOBAL_CALLS_PER_MINUTE = 300;

/**
 * POST /ai/interpret, /ai/county, /ai/situation and /ai/recommend, mounted under /api.
 *
 * The visitor's typed text goes to OpenAI only through these routes, and only the text (with
 * emails and phone numbers removed): never the contact form (rule 2). Every value that comes
 * back is checked against the options the server built (rule 3).
 *
 * The AI is never required. Exact matches (the text is a state's name, say) skip it; when it is
 * off, slow, failing or over a limit (MAX_AI_CALLS_PER_SESSION, 20 requests a minute per IP, a
 * server-wide ceiling), each route answers with its fallback and a normal 200, so the widget
 * carries on with buttons. The safety keyword check always runs, with or without the AI.
 */
export function aiRouter({ config, geo, events, client, rateLimitEnabled }: AiRouterDeps): Router {
  const router = Router();
  const specs = createStepSpecs(geo);
  const budget = new SessionBudget(config.ai.maxCallsPerSession);
  const perIp = new FixedWindowCounter(RATE_LIMITS.ai.windowMs, RATE_LIMITS.ai.max);
  const global = new FixedWindowCounter(60_000, GLOBAL_CALLS_PER_MINUTE);

  /**
   * Makes one AI call if the AI is on and the visitor is within the limits; null means "use the
   * fallback". Records the ai_call event. The call is counted against the limits when it starts.
   */
  async function ask<T>(
    req: Parameters<Parameters<Router['post']>[1]>[0],
    meta: { sessionId: string; site: string; kind: AiCallKind },
    call: (client: AiClient) => Promise<AiOutcome<T>>,
  ): Promise<T | null> {
    if (!client) return null;
    if (rateLimitEnabled) {
      if (!budget.hasRoom(meta.sessionId)) return null;
      if (!perIp.hit(clientIp(req, config.platform)).allowed) return null;
      if (!global.hit('all').allowed) return null;
    }
    budget.take(meta.sessionId);
    const outcome = await call(client);
    events.record({
      sessionId: meta.sessionId,
      site: meta.site,
      type: 'ai_call',
      data: { kind: meta.kind, ms: outcome.ms, ok: outcome.ok, tokens: outcome.tokens },
    });
    return outcome.ok ? outcome.value : null;
  }

  // ---------------------------------------------------------------- /ai/interpret

  const interpretBody = z
    .object({
      sessionId: sessionIdSchema,
      site: siteSchema,
      step: z.enum(INTERPRET_STEPS),
      text: visitorTextSchema,
      state: stateSchema(geo).optional(),
      category: z.enum(CATEGORY_KEYS).optional(),
      // Only context for the AI: anything unknown is ignored.
      at: z.enum(STEP_IDS).optional().catch(undefined),
    })
    .superRefine((value, ctx) => {
      if (value.step === 'county' && !value.state) {
        ctx.addIssue({ code: 'custom', path: ['state'], message: 'required for the county step' });
      }
      if (value.step === 'subcategory' && !(value.category && hasSubtypes(value.category))) {
        ctx.addIssue({
          code: 'custom',
          path: ['category'],
          message: 'required for the subcategory step',
        });
      }
    });

  /** The AI's hints, with a state that really exists (rule 3). */
  const checkedHints = (hints: InterpretHints): InterpretHints => ({
    ...hints,
    state: hints.state && geo.state(hints.state) ? hints.state : null,
  });

  router.post('/ai/interpret', async (req, res) => {
    const parsed = interpretBody.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { sessionId, site, step, text, state, category, at } = parsed.data;
    const safety = matchesSafetyKeywords(text);
    const spec = specs(step, { state, category });

    const exact = exactOption(text, spec.options);
    if (exact !== null) {
      const body: InterpretResponse = {
        kind: 'option',
        optionId: exact,
        reply: '',
        safety,
        sharesSituation: false,
        hints: NO_HINTS,
        source: 'exact',
      };
      return void res.json(body);
    }

    const result = await ask(req, { sessionId, site, kind: 'interpret' }, (ai) =>
      interpret(ai, { spec, text, where: whereFor(at, { joinLink: Boolean(config.links.join) }) }),
    );
    if (result) {
      const body: InterpretResponse = {
        kind: result.kind,
        optionId: result.optionId,
        reply: result.reply,
        safety: safety || result.safetyConcern,
        sharesSituation: result.sharesSituation,
        hints: checkedHints(result.hints),
        source: 'ai',
      };
      return void res.json(body);
    }

    // No AI: keywords still understand the common requests ("I need a divorce attorney"), and
    // greetings, thanks and "what can you do?" get a ready reply.
    const understood = keywordInterpret(spec, text, geo);
    const everyday = understood.optionId ? null : everydayMessage(text);
    const body: InterpretResponse = {
      kind: understood.optionId ? 'option' : everyday ? 'question' : 'unclear',
      optionId: understood.optionId,
      reply: everyday ? copy.fallback[everyday] : '',
      safety,
      sharesSituation: false,
      hints: understood.hints,
      source: understood.optionId || everyday ? 'keyword' : 'fallback',
    };
    res.json(body);
  });

  // ---------------------------------------------------------------- /ai/county

  const countyBody = z.object({
    sessionId: sessionIdSchema,
    site: siteSchema,
    state: stateSchema(geo),
    text: visitorTextSchema,
  });

  router.post('/ai/county', async (req, res) => {
    const parsed = countyBody.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { sessionId, site, state, text } = parsed.data;
    const safety = matchesSafetyKeywords(text);
    const stateInfo = geo.state(state);
    const counties = geo.counties(state);
    if (!stateInfo) return sendValidationError(res, new z.ZodError([]));

    // The text may be a county's name. "Cobb County" is that county, with no AI needed. A bare
    // name is often a city ("Houston" is in Harris County, not Houston County), so the AI gets
    // the first say and the county of that name is the answer only if the AI has none.
    const exactCounty = exactOption(
      text,
      specs('county', { state }).options.filter((option) => option.id !== 'not_sure'),
    );
    const named = exactCounty ? geo.county(exactCounty) : undefined;
    const byName: CountyFromPlaceResponse | null = named
      ? {
          countyFips: named.fips,
          countyName: named.name,
          confidence: COUNTY_WORD.test(text) ? 'high' : 'low',
          reply: '',
          safety,
          source: 'exact',
        }
      : null;
    if (byName && COUNTY_WORD.test(text)) return void res.json(byName);

    const result = await ask(req, { sessionId, site, kind: 'county' }, (ai) =>
      countyFromPlace(ai, { state: stateInfo, counties, text }),
    );
    if (byName && !result?.countyFips)
      return void res.json({ ...byName, safety: safety || !!result?.safetyConcern });
    const body: CountyFromPlaceResponse = result
      ? {
          countyFips: result.countyFips,
          countyName: result.countyName,
          confidence: result.confidence,
          reply: result.reply,
          safety: safety || result.safetyConcern,
          source: 'ai',
        }
      : {
          countyFips: null,
          countyName: null,
          confidence: 'low',
          reply: '',
          safety,
          source: 'fallback',
        };
    res.json(body);
  });

  // ---------------------------------------------------------------- /ai/situation

  const situationBody = z.object({
    sessionId: sessionIdSchema,
    site: siteSchema,
    stage: z.enum(STAGE_KEYS).nullish(),
    text: visitorTextSchema,
  });

  router.post('/ai/situation', async (req, res) => {
    const parsed = situationBody.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { sessionId, site, text } = parsed.data;
    const stage = parsed.data.stage ?? null;
    const safety = matchesSafetyKeywords(text);

    const result = await ask(req, { sessionId, site, kind: 'situation' }, (ai) =>
      situation(ai, { stage, text }),
    );
    const body: SituationResponse = result
      ? {
          reply: result.reply,
          suggestedCategories: result.suggestedCategories,
          // No summary from the AI: the form is pre-filled with the visitor's own text.
          summary: result.summary || text,
          safety: safety || result.safetyConcern,
          source: 'ai',
        }
      : {
          reply: copy.steps.situation.ack,
          suggestedCategories: [],
          summary: text,
          safety,
          source: 'fallback',
        };
    res.json(body);
  });

  // ---------------------------------------------------------------- /ai/recommend

  const recommendBody = z.object({
    sessionId: sessionIdSchema,
    site: siteSchema,
    stage: z.enum(STAGE_KEYS).nullish(),
    summary: z.string().trim().max(1500).nullish(),
  });

  router.post('/ai/recommend', async (req, res) => {
    const parsed = recommendBody.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { sessionId, site } = parsed.data;
    const stage = parsed.data.stage ?? null;
    const summary = parsed.data.summary || null;

    const result = await ask(req, { sessionId, site, kind: 'recommend' }, (ai) =>
      recommendCategories(ai, { stage, summary }),
    );
    const recommendations: Array<{ category: CategoryKey; reason: string }> =
      result?.recommendations ?? [];
    const body: RecommendResponse =
      result && recommendations.length > 0
        ? { recommendations, reply: result.reply, source: 'ai' }
        : { recommendations: [], reply: '', source: 'fallback' };
    res.json(body);
  });

  log.info('ai_routes_ready', { ai: client ? 'on' : 'off', model: config.ai.model });
  return router;
}
