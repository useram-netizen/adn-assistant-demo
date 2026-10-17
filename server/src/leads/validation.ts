import { z } from 'zod';
import {
  ANY_SUBTYPE,
  CATEGORY_KEYS,
  STAGE_KEYS,
  isSubtypeOf,
  type CategoryKey,
} from '../config/taxonomy.js';
import type { Geo } from '../domain/types.js';

/**
 * Request bodies for POST /leads and POST /contact-tracy (LeadRequest and TracyRequest in
 * shared/api.ts). The schemas trim and normalise the input; errors name the fields only,
 * never the submitted values.
 */

export const NAME_MAX = 80;
export const MESSAGE_MAX = 1500;
/** The longest valid email address. */
export const EMAIL_MAX = 254;
/** A lead goes to 1–5 professionals (checked against a fresh match). */
export const MAX_SELECTED_MEMBERS = 5;

const CONTROL_CHARACTER = /\p{Cc}/u;
/** Control characters other than line breaks and tabs. */
const STRAY_CONTROL_CHARACTERS = /[^\P{Cc}\n\t]/gu;
const PHONE_CHARACTERS = /^[0-9 +().-]+$/;
const PHONE_DIGITS = { min: 7, max: 20 };

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

/** Windows line breaks become \n; other control characters are dropped. */
export function cleanMessage(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(STRAY_CONTROL_CHARACTERS, '').trim();
}

const personName = z
  .string()
  .trim()
  .min(1)
  .max(NAME_MAX)
  .refine((value) => !CONTROL_CHARACTER.test(value), 'Names cannot contain control characters');

const emailAddress = z.string().trim().max(EMAIL_MAX).pipe(z.email());

/** Optional: digits, spaces and + ( ) - . with 7–20 digits. Empty means not given. */
const phone = z
  .string()
  .trim()
  .max(40)
  .refine(
    (value) =>
      value === '' ||
      (PHONE_CHARACTERS.test(value) &&
        digitCount(value) >= PHONE_DIGITS.min &&
        digitCount(value) <= PHONE_DIGITS.max),
    'Not a phone number',
  )
  .nullish()
  .transform((value) => value || null);

const message = z.string().transform(cleanMessage).pipe(z.string().min(1).max(MESSAGE_MAX));

/** Optional text that counts as not given when empty. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const contactShape = {
  /** A random id kept in the widget's memory (a v4 UUID). */
  sessionId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[\w-]+$/),
  /** The data-site key; unknown values are kept and shown as the generic site name. */
  site: z
    .string()
    .trim()
    .toLowerCase()
    .max(100)
    .refine((value) => !CONTROL_CHARACTER.test(value))
    .optional()
    .transform((value) => value ?? ''),
  firstName: personName,
  lastName: personName,
  email: emailAddress,
  phone,
  preferredContact: z.enum(['email', 'phone']),
  message,
  consent: z.literal(true),
  /** The honeypot: any value at all counts as filled (see isHoneypotFilled). */
  website: z.unknown().optional(),
  stage: z
    .enum(STAGE_KEYS)
    .nullish()
    .transform((value) => value ?? null),
};

/** People leave the hidden field empty; bots tend to fill it in. */
export function isHoneypotFilled(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  return typeof value === 'string' ? value.trim() !== '' : true;
}

interface PlaceInput {
  state: string | null;
  countyFips: string | null;
  category: CategoryKey | null;
  subcategory: string | null;
  preferredContact: 'email' | 'phone';
  phone: string | null;
}

/**
 * The checks that need more than one field, as on POST /match: the state is one of the 51,
 * the county is in that state, and the subtype belongs to the category. Also: a phone number
 * is needed when the visitor asked to be phoned.
 */
function checkPlace(geo: Geo, input: PlaceInput, ctx: z.RefinementCtx): void {
  const issue = (field: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [field], message });

  if (input.state !== null && !geo.state(input.state)) issue('state', 'Unknown state');
  if (input.countyFips !== null) {
    const county = geo.county(input.countyFips);
    if (!county || input.state === null || county.state !== input.state) {
      issue('countyFips', 'Not a county in that state');
    }
  }
  const subtype = input.subcategory;
  if (subtype !== null && subtype !== ANY_SUBTYPE) {
    if (input.category === null || !isSubtypeOf(input.category, subtype)) {
      issue('subcategory', 'Not a subtype of that category');
    }
  }
  if (input.preferredContact === 'phone' && !input.phone) {
    issue('phone', 'A phone number is needed to be contacted by phone');
  }
}

/** "any" (or nothing) means the whole category: stored and matched as null. */
function specificSubtype(subcategory: string | null): string | null {
  return subcategory === null || subcategory === ANY_SUBTYPE ? null : subcategory;
}

export function createLeadSchemas(geo: Geo) {
  const lead = z
    .object({
      ...contactShape,
      state: z.string().trim().toUpperCase().max(2),
      countyFips: z.string().trim().max(5),
      category: z.enum(CATEGORY_KEYS),
      subcategory: optionalText(40),
      /** Checked against a fresh match by the lead service (1–5 unique ids). */
      memberIds: z.array(z.string().trim().min(1).max(64)).max(50),
    })
    .superRefine((input, ctx) => checkPlace(geo, input, ctx))
    .transform((input) => ({ ...input, subcategory: specificSubtype(input.subcategory) }));

  const tracy = z
    .object({
      ...contactShape,
      reason: z.enum(['no_match', 'outside']),
      state: optionalText(2).transform((value) => value?.toUpperCase() ?? null),
      countyFips: optionalText(5),
      category: z
        .enum(CATEGORY_KEYS)
        .nullish()
        .transform((value) => value ?? null),
      subcategory: optionalText(40),
    })
    .superRefine((input, ctx) => checkPlace(geo, input, ctx))
    .transform((input) => ({ ...input, subcategory: specificSubtype(input.subcategory) }));

  return { lead, tracy };
}

export type LeadSchemas = ReturnType<typeof createLeadSchemas>;
export type ValidLeadRequest = z.output<LeadSchemas['lead']>;
export type ValidTracyRequest = z.output<LeadSchemas['tracy']>;

/** The top-level fields with problems, for { error: 'validation_failed', fields }. */
export function invalidFields(error: z.ZodError): string[] {
  const fields = new Set<string>();
  for (const issue of error.issues) {
    const [field] = issue.path;
    if (typeof field === 'string') fields.add(field);
  }
  return [...fields];
}
