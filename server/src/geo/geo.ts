import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { County, Geo } from '../domain/types.js';
import { US_STATES, isStateCode } from './states.js';

/**
 * US geography: the 50 states + DC and their counties, from data/us-counties-2020.csv
 * (columns state, fips, name, aliases; aliases are separated by "|").
 */

export class GeoDataError extends Error {
  override name = 'GeoDataError';
}

const CountyRowSchema = z.object({
  state: z.string().refine(isStateCode, { error: 'is not one of the 50 states + DC' }),
  fips: z.string().regex(/^\d{5}$/, { error: 'must be 5 digits' }),
  name: z.string().min(1, { error: 'is empty' }),
  aliases: z.string().default(''),
});

/** Parses and checks the county list. Throws GeoDataError, naming the bad line. */
export function parseCountiesCsv(content: string | Buffer): County[] {
  let records: Record<string, string>[];
  try {
    records = parse(content, { columns: true, bom: true, trim: true, skip_empty_lines: true });
  } catch (error) {
    throw new GeoDataError(`The county list is not valid CSV: ${(error as Error).message}`);
  }

  const counties: County[] = [];
  const seen = new Set<string>();
  records.forEach((record, index) => {
    const line = index + 2; // the header is line 1
    const parsed = CountyRowSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new GeoDataError(
        `The county list has a bad row on line ${line}: ${issue?.path.join('.') ?? 'row'} ${issue?.message ?? 'is invalid'}`,
      );
    }
    const { state, fips, name, aliases } = parsed.data;
    if (seen.has(fips)) {
      throw new GeoDataError(`The county list has FIPS ${fips} twice (line ${line})`);
    }
    seen.add(fips);
    counties.push({
      fips,
      state,
      name,
      aliases: aliases
        .split('|')
        .map((alias) => alias.trim())
        .filter(Boolean),
    });
  });
  return counties;
}

/** "Fulton County" → "Fulton", "Orleans Parish" → "Orleans"; other names stay as they are. */
export function shortCountyName(county: Pick<County, 'name'>): string {
  return county.name.replace(/ (?:County|Parish)$/, '');
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en');

/** A Geo over the given counties (all 51 states are always listed). */
export function createGeoFromCounties(counties: readonly County[]): Geo {
  const byFips = new Map<string, County>();
  const byState = new Map<string, County[]>();
  for (const county of counties) {
    const frozen = Object.freeze({ ...county, aliases: Object.freeze([...county.aliases]) });
    byFips.set(county.fips, frozen as County);
    const list = byState.get(county.state) ?? [];
    list.push(frozen as County);
    byState.set(county.state, list);
  }
  const sortedByState = new Map<string, readonly County[]>();
  for (const [state, list] of byState) sortedByState.set(state, Object.freeze(list.sort(byName)));
  const statesByCode = new Map(US_STATES.map((state) => [state.code, state]));

  return {
    states: () => US_STATES,
    state: (code) => statesByCode.get(code),
    counties: (stateCode) => sortedByState.get(stateCode) ?? [],
    county: (fips) => byFips.get(fips),
    shortCountyName,
  };
}

/** Loads data/us-counties-2020.csv. Throws if the file is missing or incomplete. */
export function createGeo(countiesFile: string): Geo {
  const counties = parseCountiesCsv(readFileSync(countiesFile));
  const missing = US_STATES.filter((state) => !counties.some((c) => c.state === state.code));
  if (missing.length > 0) {
    throw new GeoDataError(
      `The county list has no counties for ${missing.map((state) => state.code).join(', ')}`,
    );
  }
  return createGeoFromCounties(counties);
}
