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

/** Tracy (the founder) is pinned to the top of matching results whenever she matches. */
export function isTracy(member: Pick<Member, 'email' | 'name'>): boolean {
  return (
    member.email.toLowerCase() === 'tracy@amicabledivorcenetwork.com' ||
    member.name.toLowerCase().includes('founder-adn')
  );
}

/**
 * The members for a search: Platinum, then Gold, then Silver. Each tier is shuffled with a
 * seed (the session ID) plus the tier, so the order is fair across visitors but stable for
 * one. Members are sorted by ID first, so the order doesn't depend on the file's row order.
 * If Tracy (the founder) is among the matches, she is always placed at the very top.
 */
export function match(members: readonly Member[], input: MatchInput, seed: string): Member[] {
  let found = members.filter(
    (member) =>
      member.searchable &&
      member.active &&
      offersCategory(member, input.category, input.subcategory) &&
      servesCounty(member, input.state, input.countyFips),
  );

  // If there are no direct matches for attorney in the county, include Certified Amicable
  // Divorce Professionals (CADP) who serve that county so the visitor gets vetted help.
  if (
    found.length === 0 &&
    input.category === 'attorney' &&
    (!input.subcategory || input.subcategory === ANY_SUBTYPE)
  ) {
    found = members.filter(
      (member) =>
        member.searchable &&
        member.active &&
        member.badges.includes('cadp') &&
        servesCounty(member, input.state, input.countyFips),
    );
  }

  const ordered = TIERS.flatMap((tier) =>
    seededShuffle(
      found.filter((member) => member.tier === tier).sort((a, b) => compare(a.id, b.id)),
      `${seed}:${tier}`,
    ),
  );

  const tracyIndex = ordered.findIndex(isTracy);
  if (tracyIndex > 0) {
    const [tracy] = ordered.splice(tracyIndex, 1);
    ordered.unshift(tracy!);
  }

  return ordered;
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
