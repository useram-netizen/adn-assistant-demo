import { z } from 'zod';
import type { Tier } from '../config/taxonomy.js';
import type { Geo } from '../domain/types.js';
import { normalizeName } from '../geo/normalize.js';

/**
 * Parsers for single cells of the member list (spec: "Member import", rules 4, 6 and 10).
 * Multiple values in a cell are separated by ";" (states sometimes use ",").
 */

/** Splits a cell into trimmed, non-empty values. */
export function splitValues(cell: string, separator: RegExp = /;/): string[] {
  return cell
    .split(separator)
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Keeps the first of each value, comparing with `key` (exact text by default). */
export function unique<T>(values: Iterable<T>, key: (value: T) => unknown = (value) => value): T[] {
  const seen = new Set<unknown>();
  const result: T[] = [];
  for (const value of values) {
    const k = key(value);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(value);
  }
  return result;
}

// ---------------------------------------------------------------- Tiers (rule 4)

/** Current tier names, and the old plan names the client confirmed. */
const TIER_NAMES: Readonly<Record<string, Tier>> = {
  silver: 'silver',
  gold: 'gold',
  platinum: 'platinum',
  basic: 'silver',
  classic: 'silver',
  standard: 'gold',
  premium: 'platinum',
};

const TIER_RANK: Readonly<Record<Tier, number>> = { silver: 1, gold: 2, platinum: 3 };

/** "Premium" → platinum; "" → null. `known` is false for a value that is not a tier name. */
export function parseTier(cell: string): { tier: Tier | null; known: boolean } {
  const value = cell.trim().toLowerCase();
  if (!value) return { tier: null, known: true };
  const tier = Object.hasOwn(TIER_NAMES, value) ? TIER_NAMES[value] : undefined;
  return tier ? { tier, known: true } : { tier: null, known: false };
}

/** The better of two tiers (merged rows keep the highest). */
export function higherTier(a: Tier | null, b: Tier | null): Tier | null {
  if (!a) return b;
  if (!b) return a;
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}

// ---------------------------------------------------------------- Founding member (rule 10)

/** The "Founding Member (ADN)" column: "Yes" (or a ticked box exported as TRUE). */
export function isYes(cell: string): boolean {
  return /^(?:yes|y|true|x|1)$/i.test(cell.trim());
}

// ---------------------------------------------------------------- Email (rules 2 and 11)

const emailSchema = z.email();

/** Trimmed and lower-cased: the key for member IDs, merging and overrides. */
export function normalizeEmail(cell: string): string {
  return cell.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(email).success;
}

// ---------------------------------------------------------------- States (rule 6)

/** Values that mean "outside the US": Canada and its provinces, and other countries. */
const NON_US_VALUES = new Set(
  [
    'Canada',
    'Alberta',
    'British Columbia',
    'Manitoba',
    'New Brunswick',
    'Newfoundland',
    'Newfoundland and Labrador',
    'Nova Scotia',
    'Northwest Territories',
    'Nunavut',
    'Ontario',
    'Prince Edward Island',
    'Quebec',
    'Saskatchewan',
    'Yukon',
    'United Kingdom',
    'UK',
    'Great Britain',
    'England',
    'Scotland',
    'Wales',
    'Northern Ireland',
    'Ireland',
    'Mexico',
    'Australia',
    'New Zealand',
  ].map(normalizeName),
);

/** Other ways of writing DC. */
const STATE_ALIASES: Readonly<Record<string, string>> = {
  [normalizeName('Washington DC')]: 'DC',
  [normalizeName('Washington D.C.')]: 'DC',
};

export interface ParsedStates {
  /** USPS codes, in the order given, without repeats. */
  codes: string[];
  /** Non-US values such as "CANADA" or "New Brunswick". */
  outsideUS: string[];
  /** Values that are neither (a warning each). */
  unknown: string[];
}

/** Maps state names (or USPS codes) to codes; "CANADA" and the like are outside the US. */
export function createStateParser(geo: Geo): (values: readonly string[]) => ParsedStates {
  const codes = new Map<string, string>();
  for (const state of geo.states()) {
    codes.set(normalizeName(state.name), state.code);
    codes.set(normalizeName(state.code), state.code);
  }
  for (const [alias, code] of Object.entries(STATE_ALIASES)) codes.set(alias, code);

  return (values) => {
    const result: ParsedStates = { codes: [], outsideUS: [], unknown: [] };
    for (const value of values) {
      const key = normalizeName(value);
      const code = codes.get(key);
      if (code) result.codes.push(code);
      else if (NON_US_VALUES.has(key)) result.outsideUS.push(value);
      else result.unknown.push(value);
    }
    result.codes = unique(result.codes);
    return result;
  };
}

/** Splits the State(s) cell on ";" or ",", keeping "Washington, D.C." together. */
export function splitStates(cell: string): string[] {
  return splitValues(cell.replace(/washington,\s*(d\.?\s*c\.?)/gi, 'Washington $1'), /[;,]/);
}
