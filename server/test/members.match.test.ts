import { beforeAll, describe, expect, it } from 'vitest';
import type { CategoryKey } from '../src/config/taxonomy.js';
import type { MatchInput, Member } from '../src/domain/types.js';
import { createGeo } from '../src/geo/index.js';
import { toCard } from '../src/members/cards.js';
import { createMemberDirectory } from '../src/members/directory.js';
import { importMembers } from '../src/members/import.js';
import { match } from '../src/members/match.js';
import type { MemberRow } from '../src/members/readFile.js';
import { seededShuffle } from '../src/members/shuffle.js';
import { testConfig } from './helpers.js';

const config = testConfig();
const geo = createGeo(config.paths.countiesFile);

function row(overrides: Partial<Record<string, string>>): MemberRow {
  return {
    AND: 'Member',
    'Profession Type(s)': 'Lawyer- Divorce and Family Law',
    'State(s)': 'Georgia',
    'County/Parish Coverage': 'Fulton County',
    'Membership Tier': 'Silver',
    'Contact Email': 'm@example.com',
    'Founding Member (ADN)': '',
    'GrowthZone Member ID': '',
    ...overrides,
  };
}

/** Members built by the real import from a few rows. */
function members(...rows: Array<Partial<Record<string, string>>>): Member[] {
  return importMembers(
    rows.map((overrides, index) => row({ 'Contact Email': `m${index}@example.com`, ...overrides })),
    { geo, file: 'test.csv' },
  ).members;
}

const fulton = (category: CategoryKey, subcategory: string | null = null): MatchInput => ({
  state: 'GA',
  countyFips: '13121',
  category,
  subcategory,
});

const tiersOf = (found: Member[]) => found.map((member) => member.tier);

describe('matching on the real member list (spec: "Expected spot checks")', () => {
  let directory: Awaited<ReturnType<typeof createMemberDirectory>>;
  beforeAll(async () => {
    directory = await createMemberDirectory({ config, geo });
  });

  const count = (
    state: string,
    fips: string,
    category: CategoryKey,
    subcategory: string | null,
  ) => {
    const found = directory.match({ state, countyFips: fips, category, subcategory }, 'session-1');
    const by = (tier: string) => found.filter((member) => member.tier === tier).length;
    return {
      total: found.length,
      counts: `${by('platinum')}/${by('gold')}/${by('silver')}`,
      found,
    };
  };

  it.each([
    ['GA, Fulton County, attorney', 'GA', '13121', 'attorney', null, '6/10/19'],
    ['GA, Fulton County, financial (any)', 'GA', '13121', 'financial', 'any', '13/1/4'],
    ['IL, Cook County, mediator', 'IL', '17031', 'mediator', null, '3/0/10'],
    ['TX, Harris County, attorney', 'TX', '48201', 'attorney', null, '3/1/1'],
    ['NV, Clark County, attorney', 'NV', '32003', 'attorney', null, '0/1/8'],
  ] as const)(
    '%s: %s Platinum/Gold/Silver',
    (_name, state, fips, category, subcategory, expected) => {
      expect(count(state, fips, category, subcategory).counts).toBe(expected);
    },
  );

  it('WY, Teton County, attorney: no match', () => {
    expect(count('WY', '56039', 'attorney', null).total).toBe(0);
  });

  it('lists Platinum first, then Gold, then Silver', () => {
    const { found } = count('GA', '13121', 'attorney', null);
    const order = tiersOf(found)
      .map((tier) => tier![0])
      .join('');
    expect(order).toMatch(/^p{6}g{10}s{19}$/);
  });

  it('keeps the order for one session and changes it between sessions', () => {
    const input = fulton('attorney');
    const ids = (seed: string) => directory.match(input, seed).map((member) => member.id);
    expect(ids('session-1')).toEqual(ids('session-1'));
    expect(ids('session-1')).not.toEqual(ids('session-2'));
    // The tiers stay in order whatever the seed.
    expect(tiersOf(directory.match(input, 'session-2')).join('')).toMatch(
      /^(platinum)+(gold)+(silver)+$/,
    );
  });

  it('never includes members who are not searchable', () => {
    for (const member of directory.match(fulton('attorney'), 'x')) {
      expect(member.searchable && member.active).toBe(true);
    }
  });
});

describe('matching rules (spec: "Matching")', () => {
  it('shows a Platinum member in every county of their state, but not in other states', () => {
    const [platinum] = members({ 'Membership Tier': 'Platinum', 'County/Parish Coverage': '' });
    expect(match([platinum!], fulton('attorney'), 's')).toHaveLength(1);
    expect(match([platinum!], { ...fulton('attorney'), countyFips: '13067' }, 's')).toHaveLength(1);
    expect(
      match(
        [platinum!],
        { state: 'IL', countyFips: '17031', category: 'attorney', subcategory: null },
        's',
      ),
    ).toHaveLength(0);
  });

  it('needs the state and the county below Platinum', () => {
    const [gold] = members({
      'Membership Tier': 'Gold',
      'County/Parish Coverage': 'Fulton County',
    });
    expect(match([gold!], fulton('attorney'), 's')).toHaveLength(1);
    expect(match([gold!], { ...fulton('attorney'), countyFips: '13067' }, 's')).toHaveLength(0);
  });

  it('needs the category', () => {
    const [mediator] = members({ 'Profession Type(s)': 'ADR - Mediator' });
    expect(match([mediator!], fulton('attorney'), 's')).toHaveLength(0);
    expect(match([mediator!], fulton('mediator'), 's')).toHaveLength(1);
  });

  it('matches "any" subtype to the whole category, including a parent label like "Financial"', () => {
    const found = members(
      { 'Profession Type(s)': 'Financial', 'Contact Email': 'parent@example.com' },
      {
        'Profession Type(s)': 'Financial - Planner/Advisor',
        'Contact Email': 'planner@example.com',
      },
    );
    for (const subcategory of [null, 'any']) {
      expect(match(found, fulton('financial', subcategory), 's')).toHaveLength(2);
    }
  });

  it('needs that exact label for a specific subtype', () => {
    const all = members(
      { 'Profession Type(s)': 'Financial', 'Contact Email': 'parent@example.com' },
      {
        'Profession Type(s)': 'Financial - Planner/Advisor',
        'Contact Email': 'planner@example.com',
      },
      {
        'Profession Type(s)': 'Financial - Certified Divorce Financial Analyst',
        'Contact Email': 'cdfa@example.com',
      },
    );
    const cdfa = match(all, fulton('financial', 'cdfa'), 's');
    expect(cdfa.map((member) => member.email)).toEqual(['cdfa@example.com']);
    expect(match(all, fulton('financial', 'planner'), 's').map((member) => member.email)).toEqual([
      'planner@example.com',
    ]);
  });

  it('leaves out members who are not searchable or not active', () => {
    const [searchable, excluded] = members(
      { 'Contact Email': 'a@example.com' },
      { 'Contact Email': 'b@example.com', 'Membership Tier': '' },
    );
    expect(match([searchable!, excluded!], fulton('attorney'), 's')).toEqual([searchable]);
    expect(match([{ ...searchable!, active: false }], fulton('attorney'), 's')).toEqual([]);
  });
});

describe('the seeded shuffle', () => {
  const items = Array.from({ length: 30 }, (_, index) => index);

  it('gives the same order for the same seed and a different one for another seed', () => {
    expect(seededShuffle(items, 'a')).toEqual(seededShuffle(items, 'a'));
    expect(seededShuffle(items, 'a')).not.toEqual(seededShuffle(items, 'b'));
  });

  it('keeps every item exactly once and does not change the input', () => {
    const shuffled = seededShuffle(items, 'a');
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(items[0]).toBe(0);
  });
});

describe('result cards (spec: "Each card shows")', () => {
  it('shows the name, labels with the requested one first, the service area and the badges', () => {
    const [platinum] = members({
      AND: 'Pat Platinum',
      'Membership Tier': 'Platinum',
      'Profession Type(s)':
        'ADR - Mediator; Lawyer- Divorce and Family Law; Certified Amicable Divorce Professional',
      'Founding Member (ADN)': 'Yes',
      'County/Parish Coverage': '',
    });
    const card = toCard(platinum!, fulton('attorney'), geo, false);
    expect(card).toEqual({
      id: platinum!.id,
      name: 'Pat Platinum',
      tier: 'platinum',
      labels: ['Divorce & family law attorney', 'Mediator'],
      serviceArea: 'Serves all of Georgia',
      badges: ['platinum', 'cadp', 'founding'],
    });
    const mediatorFirst = toCard(platinum!, fulton('mediator'), geo, false);
    expect(mediatorFirst.labels).toEqual(['Mediator', 'Divorce & family law attorney']);
  });

  it('gives Silver no tier badge, and Gold the Gold badge', () => {
    const [silver, gold] = members({ 'Membership Tier': 'Silver' }, { 'Membership Tier': 'Gold' });
    expect(toCard(silver!, fulton('attorney'), geo, false).badges).toEqual([]);
    expect(toCard(gold!, fulton('attorney'), geo, false).badges).toEqual(['gold']);
  });

  it('lists up to 3 counties, the visitor’s first, then "+ N more"', () => {
    const [member] = members({
      'County/Parish Coverage':
        'Cobb County; DeKalb County; Fulton County; Gwinnett County; Cherokee County',
    });
    const card = toCard(member!, fulton('attorney'), geo, false);
    expect(card.serviceArea).toBe('Serves Fulton, Cobb, DeKalb + 2 more');
    const [few] = members({ 'County/Parish Coverage': 'Cobb County; Fulton County' });
    expect(toCard(few!, fulton('attorney'), geo, false).serviceArea).toBe('Serves Fulton, Cobb');
  });

  it('prefers a specific label over its parent label', () => {
    const [member] = members({
      'Profession Type(s)': 'Financial; Financial - Certified Divorce Financial Analyst',
    });
    expect(toCard(member!, fulton('financial', 'cdfa'), geo, false).labels).toEqual(['CDFA']);
  });

  it('shows the email only when SHOW_PRO_CONTACT is on (default off)', () => {
    const [member] = members({ 'Contact Email': 'private@example.com' });
    expect(toCard(member!, fulton('attorney'), geo, false)).not.toHaveProperty('email');
    expect(toCard(member!, fulton('attorney'), geo, true).email).toBe('private@example.com');
  });
});
