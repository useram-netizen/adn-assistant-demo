import { z } from 'zod';
import { siteSchema } from '../routes/validate.js';
import { sessionIdSchema } from '../routes/validate.js';

/**
 * The usage events the widget may send (spec: "Tracking"). Each type has an exact shape: only
 * option values, codes and counts, short and made of plain characters, so nothing a visitor
 * typed (a name, a sentence) can be stored by mistake. Extra keys are rejected.
 */

/** An option value or code: letters, digits and a few separators. */
const code = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const count = z.number().int().min(0).max(1_000_000);

const eventSchemas = [
  z.strictObject({
    type: z.literal('session_started'),
    data: z.strictObject({ mode: z.enum(['inline', 'bubble', 'standalone']) }),
  }),
  z.strictObject({ type: z.literal('step_viewed'), data: z.strictObject({ step: code }) }),
  z.strictObject({
    type: z.literal('answer'),
    data: z.strictObject({ step: code, value: code }),
  }),
  z.strictObject({
    type: z.literal('branch'),
    data: z.strictObject({ branch: z.enum(['pro', 'uk', 'outside']) }),
  }),
  z.strictObject({
    type: z.literal('results_shown'),
    data: z.strictObject({
      platinum: count,
      gold: count,
      silver: count,
      total: count,
      category: code,
      state: code,
    }),
  }),
  z.strictObject({
    type: z.literal('no_match'),
    data: z.strictObject({ category: code, state: code, countyFips: code }),
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

const clientEvent = z
  .discriminatedUnion('type', eventSchemas)
  .and(z.object({ at: z.iso.datetime({ offset: true }) }));

export const eventsBody = z.strictObject({
  sessionId: sessionIdSchema,
  site: siteSchema,
  events: z.array(clientEvent).min(1).max(50),
});

export type ValidEventsBody = z.output<typeof eventsBody>;
