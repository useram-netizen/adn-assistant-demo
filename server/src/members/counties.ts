import type { County, Geo } from '../domain/types.js';
import { normalizeName } from '../geo/normalize.js';

/**
 * Matching the pieces of the "County/Parish Coverage" column to counties (spec: "Member
 * import", rule 7). Many pieces have extra text glued to the front ("GA Fulton County",
 * "Marla Marinucci Cape May County"), so a piece names the county in its trailing words.
 */

/** County names and aliases, normalised, by state. */
export interface CountyNameIndex {
  /** Every state code, for members without a state. */
  readonly allStates: readonly string[];
  /** The counties in `state` with this normalised name or alias (usually one). */
  find(state: string, normalizedName: string): readonly County[];
}

const indexes = new WeakMap<Geo, CountyNameIndex>();

/** Builds the index once per Geo. */
export function countyNameIndex(geo: Geo): CountyNameIndex {
  const cached = indexes.get(geo);
  if (cached) return cached;

  const byState = new Map<string, Map<string, County[]>>();
  for (const state of geo.states()) {
    const names = new Map<string, County[]>();
    for (const county of geo.counties(state.code)) {
      for (const name of new Set([county.name, ...county.aliases].map(normalizeName))) {
        if (!name) continue;
        const list = names.get(name) ?? [];
        list.push(county);
        names.set(name, list);
      }
    }
    byState.set(state.code, names);
  }

  const index: CountyNameIndex = {
    allStates: geo.states().map((state) => state.code),
    find: (state, normalizedName) => byState.get(state)?.get(normalizedName) ?? [],
  };
  indexes.set(geo, index);
  return index;
}

export interface CountyPieceMatch {
  /** The trailing words of the piece that name the county: the whole piece unless stripped. */
  text: string;
  /** Extra words in front of the county name were removed. */
  stripped: boolean;
  /** The county with that name in each of the searched states that has one. */
  counties: County[];
}

/**
 * Takes the longest run of trailing words of `piece` that matches a county name or alias in
 * one of `states`, comparing with normalizeName (ignoring case, accents, spaces and
 * punctuation). Longest first, so "Jeff Davis County" is never cut down to "Davis County".
 * Returns null when no run matches.
 */
export function matchCountyPiece(
  index: CountyNameIndex,
  piece: string,
  states: readonly string[],
): CountyPieceMatch | null {
  const wordStarts = [...piece.matchAll(/\S+/g)].map((word) => word.index);
  for (const [position, start] of wordStarts.entries()) {
    const text = piece.slice(start).trim();
    const name = normalizeName(text);
    if (!name) continue;
    const counties = states.flatMap((state) => index.find(state, name));
    if (counties.length > 0) return { text, stripped: position > 0, counties };
  }
  return null;
}
