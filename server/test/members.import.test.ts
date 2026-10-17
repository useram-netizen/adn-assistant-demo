import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGeo } from '../src/geo/index.js';
import { importMembers, memberId } from '../src/members/import.js';
import { readMemberFile, type MemberRow } from '../src/members/readFile.js';
import { formatImportReport } from '../src/members/report.js';
import { testConfig } from './helpers.js';

const config = testConfig();
const geo = createGeo(config.paths.countiesFile);

/** A valid member row; tests override what they care about. */
function row(overrides: Partial<Record<string, string>> = {}): MemberRow {
  return {
    AND: 'Test Member',
    'Profession Type(s)': 'Lawyer- Divorce and Family Law',
    'State(s)': 'Georgia',
    'County/Parish Coverage': 'Fulton County',
    'Membership Tier': 'Silver',
    'Contact Email': 'test@example.com',
    'Founding Member (ADN)': '',
    'GrowthZone Member ID': '',
    ...overrides,
  };
}

function importRows(rows: MemberRow[], overrides = {}) {
  return importMembers(rows, { geo, file: 'test.csv', overrides });
}

function importOne(overrides: Partial<Record<string, string>> = {}) {
  const { members, report } = importRows([row(overrides)]);
  return { member: members[0]!, report };
}

describe('the member import on the real data/members.csv (spec: "Expected dry-run result")', () => {
  let report: ReturnType<typeof importRows>['report'];
  let members: ReturnType<typeof importRows>['members'];
  beforeAll(async () => {
    ({ report, members } = importRows(await readMemberFile(config.paths.membersFile)));
  });

  it('turns 213 rows into 211 members, merging Storey Jones and Tammy M. Gruen', () => {
    expect(report.rows).toBe(213);
    expect(report.members).toBe(211);
    expect(report.mergedMembers).toEqual(['Storey Jones', 'Tammy M. Gruen, MBA, CDFA®']);
  });

  it('counts the tiers: silver 121, gold 51, platinum 34, none 5', () => {
    expect(report.tiers).toEqual({ silver: 121, gold: 51, platinum: 34, none: 5 });
  });

  it('finds 199 searchable members (silver 115, gold 50, platinum 34)', () => {
    expect(report.searchable).toEqual({ total: 199, silver: 115, gold: 50, platinum: 34 });
  });

  it('lists the 12 members who are not searchable, with the right reasons', () => {
    const reasons = Object.fromEntries(report.notSearchable.map((m) => [m.name, m.reasons]));
    expect(Object.keys(reasons).sort()).toEqual(
      [
        'Jody Bruns',
        'Karis Nafte',
        'Steven Bradley',
        'Lisa Johnson',
        'T.H. Irwin',
        'Storey Jones',
        'Susan Guthrie',
        'Adam Rettemnier',
        'Jackie Lynch',
        'Molly Rosenblum Esq.',
        'Anastasia McCargo',
        'Savannagh Gabriel',
      ].sort(),
    );
    // Only a name and an email.
    for (const name of [
      'Jody Bruns',
      'Karis Nafte',
      'Steven Bradley',
      'Lisa Johnson',
      'T.H. Irwin',
    ]) {
      expect(reasons[name]).toEqual(
        expect.arrayContaining(['no_tier', 'no_profession', 'no_us_state']),
      );
    }
    // Supporters.
    expect(reasons['Storey Jones']).toContain('supporter_only');
    expect(reasons['Susan Guthrie']).toEqual(['supporter_only']);
    // Not Platinum and no counties.
    for (const name of [
      'Adam Rettemnier',
      'Jackie Lynch',
      'Molly Rosenblum Esq.',
      'Anastasia McCargo',
    ]) {
      expect(reasons[name]).toEqual(['no_counties']);
    }
    // Outside the US.
    expect(reasons['Savannagh Gabriel']).toEqual(['outside_us']);
  });

  it('counts 34 CADP badges and two founding members', () => {
    expect(report.badges.cadp).toBe(34);
    expect(report.badges.founding.sort()).toEqual(['Kathy Bloom', 'Meredith Buck']);
  });

  it('infers Anita Savage’s state as TX', () => {
    expect(report.inferredStates).toEqual([{ name: 'Anita Savage', state: 'TX' }]);
    const anita = members.find((m) => m.name === 'Anita Savage');
    expect(anita?.states).toEqual(['TX']);
    expect(anita?.inferredState).toBe('TX');
  });

  it('strips extra text from exactly 49 county pieces, including the spec’s examples', () => {
    expect(report.strippedPieces).toHaveLength(49);
    const pairs = new Set(report.strippedPieces.map((p) => `${p.before} → ${p.after}`));
    for (const example of [
      'GA Fulton County → Fulton County',
      'Buying Cherokee County → Cherokee County',
      'Alex Adams Xandra LLC Kane County → Kane County',
      'Jason Wiggam Wiggam Law Bibb County → Bibb County',
      'LLC www.wearegettingdivorced.com Cook County → Cook County',
      'I serve clients throughout Forsyth County → Forsyth County',
      'Marla Marinucci Cape May County → Cape May County',
    ]) {
      expect(pairs.has(example), example).toBe(true);
    }
  });

  it('drops exactly 6 county pieces that match no county', () => {
    expect(report.unmatchedPieces).toHaveLength(6);
    const byPiece = new Map<string, string[]>();
    for (const { piece, member } of report.unmatchedPieces) {
      byPiece.set(piece, [...(byPiece.get(piece) ?? []), member]);
    }
    expect(byPiece.get('Texas County')?.sort()).toEqual(
      ['Keli Hazel, CPA, BFA', 'Angela Deaton', 'Cari Rincker', 'Pamela Smith'].sort(),
    );
    expect(byPiece.get('Nevada County')).toEqual(['Joe Caldera, CFP®, CRPS®']);
    expect(byPiece.get('Mississippi County')).toEqual(['Chris Bruser']);
  });

  it('knows every profession label in the file', () => {
    expect(report.unknownProfessions).toEqual([]);
  });

  it('gives every member a stable ID from their email', () => {
    const ids = new Set(members.map((m) => m.id));
    expect(ids.size).toBe(members.length);
    for (const member of members) expect(member.id).toMatch(/^m_[0-9a-f]{12}$/);
  });

  it('prints a report with the counts and every section', () => {
    const text = formatImportReport(report);
    expect(text).toContain('213 → 211 members');
    expect(text).toContain('Searchable:      199 (silver 115, gold 50, platinum 34)');
    expect(text).toContain('GA Fulton County → Fulton County');
    expect(text).toContain('Anita Savage → TX');
  });
});

describe('member IDs', () => {
  it('are "m_" and the first 12 hex characters of sha1 of the trimmed, lower-case email', () => {
    const expected = createHash('sha1').update('jane@example.com').digest('hex').slice(0, 12);
    expect(memberId('  Jane@Example.COM ')).toBe(`m_${expected}`);
    expect(memberId('jane@example.com')).toBe(memberId('JANE@example.com'));
  });
});

describe('tiers (rule 4)', () => {
  it.each([
    ['Silver', 'silver'],
    ['Gold', 'gold'],
    ['Platinum', 'platinum'],
    ['Basic', 'silver'],
    ['Classic', 'silver'],
    ['Standard', 'gold'],
    ['Premium', 'platinum'],
    ['  premium ', 'platinum'],
  ])('%s is %s', (cell, tier) => {
    expect(importOne({ 'Membership Tier': cell }).member.tier).toBe(tier);
  });

  it('treats a blank tier as no tier, and not searchable', () => {
    const { member } = importOne({ 'Membership Tier': '' });
    expect(member.tier).toBeNull();
    expect(member.searchable).toBe(false);
    expect(member.notSearchableReasons).toContain('no_tier');
  });

  it('warns about a tier it does not know', () => {
    const { member, report } = importOne({ 'Membership Tier': 'Diamond' });
    expect(member.tier).toBeNull();
    expect(report.warnings.join(' ')).toContain('Diamond');
  });
});

describe('merging rows with the same email (rule 3)', () => {
  it('combines professions, states and counties, keeps the highest tier and the first name', () => {
    const { members, report } = importRows([
      row({
        AND: 'First Name',
        'Contact Email': 'Shared@Example.com',
        'Membership Tier': 'Silver',
        'Profession Type(s)': 'Lawyer- Divorce and Family Law',
        'State(s)': 'Georgia',
        'County/Parish Coverage': 'Fulton County',
      }),
      row({
        AND: 'Second Name',
        'Contact Email': ' shared@example.com ',
        'Membership Tier': 'Gold',
        'Profession Type(s)': 'ADR - Mediator',
        'State(s)': 'Illinois',
        'County/Parish Coverage': 'Cook County',
      }),
    ]);
    expect(members).toHaveLength(1);
    const [member] = members;
    expect(member?.name).toBe('First Name');
    expect(member?.tier).toBe('gold');
    expect(member?.professions.map((p) => p.category).sort()).toEqual(['attorney', 'mediator']);
    expect(member?.states.sort()).toEqual(['GA', 'IL']);
    // Each name is added for every one of the member's states that has it (Georgia has a Cook
    // County too, and Illinois has a Fulton County).
    expect(member?.counties.sort()).toEqual(['13075', '13121', '17031', '17057']);
    expect(report.rows).toBe(2);
    expect(report.members).toBe(1);
    expect(report.mergedMembers).toEqual(['First Name']);
  });
});

describe('professions (rule 5)', () => {
  it('maps sheet labels to categories and subtypes, ignoring case and spaces around "-"', () => {
    const { member } = importOne({
      'Profession Type(s)':
        'financial - certified divorce financial analyst; Coaching - Divorce Transition',
    });
    expect(member.professions).toEqual([
      {
        label: 'Financial - Certified Divorce Financial Analyst',
        category: 'financial',
        subtype: 'cdfa',
      },
      { label: 'Coaching - Divorce Transition', category: 'coach', subtype: 'transition' },
    ]);
  });

  it('takes the CADP label as a badge, not a profession', () => {
    const { member } = importOne({
      'Profession Type(s)': 'Certified Amicable Divorce Professional; ADR - Mediator',
    });
    expect(member.badges).toContain('cadp');
    expect(member.professions.map((p) => p.category)).toEqual(['mediator']);
  });

  it('takes "Amicable Divorce Supporter" as a flag: a supporter-only member is not searchable', () => {
    const { member } = importOne({ 'Profession Type(s)': 'Amicable Divorce Supporter' });
    expect(member.supporter).toBe(true);
    expect(member.searchable).toBe(false);
    expect(member.notSearchableReasons).toEqual(['supporter_only']);
  });

  it('keeps "Legal" on its own as a profession that matches nothing', () => {
    const { member, report } = importOne({ 'Profession Type(s)': 'Legal' });
    expect(member.professions).toEqual([]);
    expect(report.warnings.join(' ')).toMatch(/Legal.*matches no kind of professional/);
  });

  it('reports a label it does not know', () => {
    const { member, report } = importOne({ 'Profession Type(s)': 'ADR - Mediator; Astrology' });
    expect(report.unknownProfessions).toEqual([{ member: 'Test Member', label: 'Astrology' }]);
    expect(member.professions.map((p) => p.category)).toEqual(['mediator']);
  });

  it('counts an unlisted "Financial - …" label as Financial, with a warning', () => {
    const { member, report } = importOne({ 'Profession Type(s)': 'Financial - Crypto' });
    expect(member.professions.map((p) => [p.category, p.subtype])).toEqual([['financial', null]]);
    expect(report.unknownProfessions).toHaveLength(1);
  });
});

describe('states (rule 6)', () => {
  it('maps names (and codes) to USPS codes, split on ";" or ","', () => {
    expect(importOne({ 'State(s)': 'Georgia; Illinois' }).member.states).toEqual(['GA', 'IL']);
    expect(importOne({ 'State(s)': 'Georgia, Texas' }).member.states).toEqual(['GA', 'TX']);
    expect(importOne({ 'State(s)': 'ga' }).member.states).toEqual(['GA']);
  });

  it('treats CANADA and New Brunswick as outside the US', () => {
    const { member } = importOne({
      'State(s)': 'CANADA; New Brunswick',
      'County/Parish Coverage': '',
    });
    expect(member.outsideUS).toBe(true);
    expect(member.states).toEqual([]);
    expect(member.searchable).toBe(false);
    expect(member.notSearchableReasons).toEqual(['outside_us']);
  });
});

describe('county pieces (rule 7)', () => {
  const counties = (cell: string, states = 'Georgia') =>
    importOne({ 'County/Parish Coverage': cell, 'State(s)': states }).member.counties;

  it('removes text glued to the front: state codes, firm names, credentials', () => {
    expect(counties('GA Fulton County')).toEqual(['13121']);
    expect(counties('Law Offices of Smith LLC Cobb County')).toEqual(['13067']);
    expect(counties('I serve clients throughout Forsyth County')).toEqual(['13117']);
  });

  it('keeps "Jeff Davis County" whole, taking the longest run of trailing words', () => {
    const { report, member } = importOne({
      'County/Parish Coverage': 'Jeff Davis County',
      'State(s)': 'Georgia',
    });
    expect(member.counties).toEqual(['13161']);
    expect(geo.county('13161')?.name).toBe('Jeff Davis County');
    expect(report.strippedPieces).toEqual([]);
  });

  it('does not confuse "Baltimore city" with "Baltimore County"', () => {
    const city = counties('Baltimore city', 'Maryland');
    const county = counties('Baltimore County', 'Maryland');
    expect(city).toEqual(['24510']);
    expect(county).toEqual(['24005']);
    expect(counties('Baltimore city; Baltimore County', 'Maryland').sort()).toEqual([
      '24005',
      '24510',
    ]);
  });

  it('ignores case, accents, spaces and punctuation: De Witt = DeWitt, Doña Ana = Dona Ana', () => {
    expect(counties('DeWitt County', 'Illinois')).toEqual(['17039']);
    expect(counties('De Witt County', 'Illinois')).toEqual(['17039']);
    expect(counties('Dona Ana County', 'New Mexico')).toEqual(['35013']);
    expect(counties('Doña Ana County', 'New Mexico')).toEqual(['35013']);
    expect(counties('COBB county', 'Georgia')).toEqual(['13067']);
  });

  it('adds a name for each of the member’s states that has it', () => {
    expect(counties('Fulton County', 'Georgia; Illinois').sort()).toEqual(['13121', '17057']);
  });

  it('matches only in the member’s states', () => {
    const { member, report } = importOne({
      'County/Parish Coverage': 'Los Angeles County',
      'State(s)': 'Georgia',
    });
    expect(member.counties).toEqual([]);
    expect(report.unmatchedPieces).toEqual([
      { member: 'Test Member', piece: 'Los Angeles County' },
    ]);
  });

  it('uses an alias', () => {
    expect(counties('Valdez-Cordova Census Area', 'Alaska')).toEqual(['02063']);
  });

  it('drops a piece that matches nothing, with a warning', () => {
    const { member, report } = importOne({
      'County/Parish Coverage': 'Atlantis County; Cobb County',
    });
    expect(member.counties).toEqual(['13067']);
    expect(report.unmatchedPieces).toHaveLength(1);
    expect(report.warnings.join(' ')).toContain('Atlantis County');
  });
});

describe('a member with no state (rule 8)', () => {
  it('gets the single state that has all of the counties, with a warning', () => {
    const { member, report } = importOne({
      'State(s)': '',
      'County/Parish Coverage': 'Jeff Davis County; Cobb County',
    });
    expect(member.states).toEqual(['GA']);
    expect(member.inferredState).toBe('GA');
    expect(member.searchable).toBe(true);
    expect(report.inferredStates).toEqual([{ name: 'Test Member', state: 'GA' }]);
    expect(report.warnings.join(' ')).toContain('inferred GA');
  });

  it('is not searchable when no single state fits', () => {
    const { member } = importOne({
      'State(s)': '',
      'County/Parish Coverage': 'Cobb County; Los Angeles County',
    });
    expect(member.states).toEqual([]);
    expect(member.searchable).toBe(false);
    expect(member.notSearchableReasons).toContain('no_us_state');
  });
});

describe('searchable (rules 9 and 11)', () => {
  it('lets Platinum members be searchable without counties (they are statewide)', () => {
    const { member } = importOne({ 'Membership Tier': 'Platinum', 'County/Parish Coverage': '' });
    expect(member.searchable).toBe(true);
  });

  it('needs counties below Platinum', () => {
    for (const tier of ['Silver', 'Gold']) {
      const { member } = importOne({ 'Membership Tier': tier, 'County/Parish Coverage': '' });
      expect(member.searchable).toBe(false);
      expect(member.notSearchableReasons).toEqual(['no_counties']);
    }
  });

  it('needs an email', () => {
    const { member } = importOne({ 'Contact Email': '' });
    expect(member.searchable).toBe(false);
    expect(member.notSearchableReasons).toContain('no_email');
  });

  it('marks "Yes" as the founding member badge', () => {
    expect(importOne({ 'Founding Member (ADN)': 'Yes' }).member.badges).toEqual(['founding']);
    expect(importOne({ 'Founding Member (ADN)': '' }).member.badges).toEqual([]);
  });
});

describe('overrides (rule 12)', () => {
  it('excludes a member by email, applied last, and says so in the report', () => {
    const rows = [row({ 'Contact Email': 'Leaving@Example.com' })];
    const { members, report } = importRows(rows, {
      'leaving@example.com': { exclude: true, reason: 'Left the network' },
    });
    expect(members[0]?.searchable).toBe(false);
    expect(members[0]?.notSearchableReasons).toEqual(['excluded']);
    expect(report.overridesApplied).toEqual([
      { email: 'leaving@example.com', action: 'exclude (Left the network)' },
    ]);
  });

  it('warns about an override for an email that is not in the file', () => {
    const { report } = importRows([row()], { 'nobody@example.com': { exclude: true } });
    expect(report.warnings.join(' ')).toContain('nobody@example.com');
  });
});

describe('the file itself (rules 1 and the columns)', () => {
  it('skips empty rows', () => {
    const empty: MemberRow = Object.fromEntries<string>(Object.keys(row()).map((key) => [key, '']));
    const { members, report } = importRows([
      row(),
      empty,
      row({ 'Contact Email': 'b@example.com' }),
    ]);
    expect(members).toHaveLength(2);
    expect(report.emptyRowsSkipped).toBe(1);
  });

  it('accepts the corrected "ADN" header as well as the typo "AND"', () => {
    const { AND, ...rest } = row({ AND: 'Named Member' });
    const { members } = importRows([{ ADN: AND, ...rest } as MemberRow]);
    expect(members[0]?.name).toBe('Named Member');
  });

  it('refuses a file with a required column missing', () => {
    const rest = row();
    delete rest['Contact Email'];
    expect(() => importRows([rest])).toThrow(/Contact Email/);
  });
});
