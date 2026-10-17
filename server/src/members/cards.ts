import { copy, fill } from '../config/copy.js';
import type { County, Geo, MatchInput, Member, MemberProfession } from '../domain/types.js';
import type { CardBadge, ProfessionalCard } from '../shared/api.js';
import { specificSubtype } from './match.js';

/** Result cards (spec: "Matching", "Each card shows"). All wording comes from copy.ts. */

/** How many county names a card lists before "+ N more". */
export const CARD_COUNTY_LIMIT = 3;

export function toCard(
  member: Member,
  input: MatchInput,
  geo: Geo,
  showProContact: boolean,
): ProfessionalCard {
  const card: ProfessionalCard = {
    id: member.id,
    name: member.name,
    // Matched members always have a tier (rule 11); Silver is the safe reading otherwise.
    tier: member.tier ?? 'silver',
    labels: cardLabels(member, input),
    serviceArea: serviceArea(member, input, geo),
    badges: cardBadges(member),
  };
  // SHOW_PRO_CONTACT (OPEN, default false): the email stays on the server unless it is on.
  if (showProContact) card.email = member.email;
  return card;
}

/**
 * Display labels: the requested subtype first, then the member's other labels in that
 * category, then the rest (taxonomy order), each once. A parent label ("Financial") is left
 * out when the member has a more specific label in the same category ("CDFA").
 */
export function cardLabels(
  member: Pick<Member, 'professions'>,
  input: Pick<MatchInput, 'category' | 'subcategory'>,
): string[] {
  const subtype = specificSubtype(input.subcategory);
  const rank = (profession: MemberProfession): number => {
    if (profession.category !== input.category) return 3;
    if (subtype !== null && profession.subtype === subtype) return 0;
    return profession.subtype === null ? 2 : 1;
  };
  const specific = new Set(
    member.professions.filter((p) => p.subtype !== null).map((p) => p.category),
  );
  const shown = member.professions
    .filter((profession) => profession.subtype !== null || !specific.has(profession.category))
    .map((profession, order) => ({ profession, order }))
    .sort((a, b) => rank(a.profession) - rank(b.profession) || a.order - b.order);
  return [...new Set(shown.map(({ profession }) => copy.cards.professionLabels[profession.label]))];
}

/**
 * "Serves all of Georgia" for Platinum. Otherwise up to 3 short county names in the
 * visitor's state, the visitor's county first: "Serves Fulton, Cobb, DeKalb + 2 more".
 */
export function serviceArea(
  member: Pick<Member, 'tier' | 'counties'>,
  input: Pick<MatchInput, 'state' | 'countyFips'>,
  geo: Geo,
): string {
  const stateName = geo.state(input.state)?.name ?? input.state;
  if (member.tier === 'platinum') return fill(copy.cards.servesAllOf, { state: stateName });

  const inState = member.counties
    .map((fips) => geo.county(fips))
    .filter((county): county is County => county?.state === input.state);
  const ordered = [
    ...inState.filter((county) => county.fips === input.countyFips),
    ...inState.filter((county) => county.fips !== input.countyFips),
  ];
  if (ordered.length === 0) return fill(copy.cards.serves, { list: stateName });

  const list = ordered
    .slice(0, CARD_COUNTY_LIMIT)
    .map((county) => geo.shortCountyName(county))
    .join(', ');
  const more = ordered.length - CARD_COUNTY_LIMIT;
  return more > 0 ? fill(copy.cards.servesMore, { list, n: more }) : fill(copy.cards.serves, { list });
}

/** Platinum or Gold (Silver gets no tier badge), then CADP and Founding Member. */
export function cardBadges(member: Pick<Member, 'tier' | 'badges'>): CardBadge[] {
  const badges: CardBadge[] = [];
  if (member.tier === 'platinum' || member.tier === 'gold') badges.push(member.tier);
  if (member.badges.includes('cadp')) badges.push('cadp');
  if (member.badges.includes('founding')) badges.push('founding');
  return badges;
}
