import { z } from 'zod';
import { CATEGORY_KEYS, STAGE_KEYS, SUBTYPES } from '../config/taxonomy.js';
import { siteSchema, sessionIdSchema } from '../routes/validate.js';
import { STEP_IDS } from '../shared/api.js';

/**
 * The usage events the widget may send (spec: "Tracking"). Each type has an exact shape and every
 * value comes from a fixed list (screens, option ids, state codes, county codes), so nothing a
 * visitor typed (a name, a sentence, a number) can be stored, and a made-up value is refused.
 * Extra keys are rejected. results_shown and no_match are recorded by the server (see
 * routes/match.ts), not accepted here.
 */

/** The ids a button or a list can answer with (the widget's `answer` events). */
const NAMED_ANSWERS: ReadonlySet<string> = new Set([
  'divorce',
  'professional',
  'uk',
  'outside',
  'not_sure',
  'yes',
  'no',
  'tracy',
  'another',
  'restart',
  'skip',
  'more',
  'see_all',
  'any',
  ...STAGE_KEYS,
  ...CATEGORY_KEYS,
  ...Object.values(SUBTYPES).flat(),
]);

/** A state's USPS code, a county's five-digit code, or one of the named answers. */
const answerValue = z
  .string()
  .max(40)
  .refine((value) => NAMED_ANSWERS.has(value) || /^[A-Z]{2}$/.test(value) || /^\d{5}$/.test(value));

const eventSchemas = [
  z.strictObject({
    type: z.literal('session_started'),
    data: z.strictObject({ mode: z.enum(['inline', 'bubble', 'standalone']) }),
  }),
  z.strictObject({
    type: z.literal('step_viewed'),
    data: z.strictObject({ step: z.enum(STEP_IDS) }),
  }),
  z.strictObject({
    type: z.literal('answer'),
    data: z.strictObject({ step: z.enum(STEP_IDS), value: answerValue }),
  }),
  z.strictObject({
    type: z.literal('branch'),
    data: z.strictObject({ branch: z.enum(['pro', 'uk', 'outside']) }),
  }),
  z.strictObject({
    type: z.literal('pros_selected'),
    data: z.strictObject({ count: z.number().int().min(1).max(5) }),
  }),
  z.strictObject({
    type: z.literal('link_clicked'),
    data: z.strictObject({
      link: z.enum(['join', 'uk_site', 'articles', 'podcast', 'booking', 'privacy', 'safety']),
    }),
  }),
  z.strictObject({
    type: z.literal('safety_shown'),
    data: z.strictObject({ trigger: z.enum(['keyword', 'ai']) }),
  }),
] as const;

/** The widget sends at most this many events at a time (it flushes every few seconds). */
export const MAX_EVENTS_PER_REQUEST = 50;

const clientEvent = z
  .discriminatedUnion('type', eventSchemas)
  .and(z.object({ at: z.iso.datetime({ offset: true }) }));

export const eventsBody = z.strictObject({
  sessionId: sessionIdSchema,
  site: siteSchema,
  events: z.array(clientEvent).min(1).max(MAX_EVENTS_PER_REQUEST),
});

export type ValidEventsBody = z.output<typeof eventsBody>;
