import { ANY_SUBTYPE, TIERS, type CategoryKey } from '../config/taxonomy.js';
import type { MatchInput, Member } from '../domain/types.js';
import { seededShuffle } from './shuffle.js';

/**
 * Matching (spec: "Matching"). A member matches when they are searchable and active, offer
 * the category (and the subtype, if one was picked), and either are Platinum with that
 * state (statewide) or list that state and county.
 */

/** null or "any" = the whole category, including parent labels such as "Financial". */
export function specificSubtype(subcategory: string | null | undefined): string | null {
  return subcategory && subcategory !== ANY_SUBTYPE ? subcategory : null;
}

/** A specific subtype needs that exact label; "any" matches every label in the category. */
export function offersCategory(
  member: Pick<Member, 'professions'>,
  category: CategoryKey,
  subcategory: string | null,
): boolean {
  const subtype = specificSubtype(subcategory);
  return member.professions.some(
    (profession) =>
      profession.category === category && (subtype === null || profession.subtype === subtype),
  );
}

/** Platinum members serve every county of their states; the others serve their counties. */
export function servesCounty(
  member: Pick<Member, 'tier' | 'states' | 'counties'>,
  state: string,
  countyFips: string,
): boolean {
  if (!member.states.includes(state)) return false;
  return member.tier === 'platinum' || member.counties.includes(countyFips);
}

/**
 * The members for a search: Platinum, then Gold, then Silver. Each tier is shuffled with a
 * seed (the session ID) plus the tier, so the order is fair across visitors but stable for
 * one. Members are sorted by ID first, so the order doesn't depend on the file's row order.
 */
export function match(members: readonly Member[], input: MatchInput, seed: string): Member[] {
  const found = members.filter(
    (member) =>
      member.searchable &&
      member.active &&
      offersCategory(member, input.category, input.subcategory) &&
      servesCounty(member, input.state, input.countyFips),
  );
  return TIERS.flatMap((tier) =>
    seededShuffle(
      found.filter((member) => member.tier === tier).sort((a, b) => compare(a.id, b.id)),
      `${seed}:${tier}`,
    ),
  );
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
