import { createHash } from 'node:crypto';
import type { Tier } from '../config/taxonomy.js';
import type { County, Geo, ImportReport, Member, NotSearchableReason } from '../domain/types.js';
import { normalizeName } from '../geo/normalize.js';
import { countyNameIndex, matchCountyPiece, type CountyNameIndex } from './counties.js';
import {
  createStateParser,
  higherTier,
  isValidEmail,
  isYes,
  normalizeEmail,
  parseTier,
  splitStates,
  splitValues,
  unique,
  type ParsedStates,
} from './fields.js';
import type { MemberOverrides } from './overrides.js';
import { classifyLabel, normalizeLabel, parseProfessions } from './professions.js';
import type { MemberRow } from './readFile.js';

/**
 * The member import (spec: "Member import"). Turns the rows of the member list into members,
 * applying the spec's rules in order, and reports what it did. Pure: no files, no logging.
 */

export interface ImportOptions {
  geo: Geo;
  /** data/member-overrides.json, keyed by lower-case email (rule 12). */
  overrides?: MemberOverrides;
  /** The member file, shown in the report. */
  file: string;
}

export interface ImportResult {
  members: Member[];
  report: ImportReport;
}

/** The rows can't be imported at all (a required column is missing). */
export class ImportError extends Error {
  override name = 'ImportError';
}

/** Rule 2: "m_" + the first 12 hex characters of sha1(trimmed, lower-case email). */
export function memberId(email: string): string {
  return `m_${createHash('sha1').update(normalizeEmail(email)).digest('hex').slice(0, 12)}`;
}

// ---------------------------------------------------------------- Columns

/** Header names per field, compared with normalizeName (the spec's names first). */
const COLUMNS = {
  // "AND" is a typo for "ADN" in the client's sheet; accept the fixed spelling too.
  name: ['AND', 'ADN', 'Name'],
  professions: ['Profession Type(s)', 'Professions'],
  states: ['State(s)', 'State'],
  counties: ['County/Parish Coverage', 'Counties'],
  tier: ['Membership Tier', 'Tier'],
  email: ['Contact Email', 'Email'],
  founding: ['Founding Member (ADN)', 'Founding Member'],
} as const satisfies Record<string, readonly string[]>;

type Field = keyof typeof COLUMNS;
const FIELDS = Object.keys(COLUMNS) as Field[];
const OPTIONAL_FIELDS: ReadonlySet<Field> = new Set<Field>(['founding']);

/** One row of the file, by field. `number` is the spreadsheet row (the header is row 1). */
type SourceRow = Record<Field, string> & { number: number };

function resolveColumns(rows: readonly MemberRow[]): Record<Field, string | null> {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const columns = {} as Record<Field, string | null>;
  for (const field of FIELDS) {
    const wanted = new Set(COLUMNS[field].map(normalizeName));
    const header = headers.find((name) => wanted.has(normalizeName(name))) ?? null;
    if (!header && rows.length > 0 && !OPTIONAL_FIELDS.has(field)) {
      throw new ImportError(
        `The member file has no "${COLUMNS[field][0]}" column (its columns are: ${headers.join(', ')})`,
      );
    }
    columns[field] = header;
  }
  return columns;
}

function readRow(row: MemberRow, columns: Record<Field, string | null>, number: number): SourceRow {
  const source = { number } as SourceRow;
  for (const field of FIELDS) {
    const column = columns[field];
    source[field] = column ? (row[column] ?? '').trim() : '';
  }
  return source;
}

// ---------------------------------------------------------------- The import

/** What the import found, for the report. */
interface Findings {
  warnings: string[];
  inferredStates: ImportReport['inferredStates'];
  strippedPieces: ImportReport['strippedPieces'];
  unmatchedPieces: ImportReport['unmatchedPieces'];
  unknownProfessions: ImportReport['unknownProfessions'];
  overridesApplied: ImportReport['overridesApplied'];
}

interface Context {
  index: CountyNameIndex;
  parseStates: (values: readonly string[]) => ParsedStates;
  findings: Findings;
}

/** The rows of one member: one row, or several that share an email (rule 3). */
interface MemberSource {
  email: string;
  rows: [SourceRow, ...SourceRow[]];
}

export function importMembers(
  rows: readonly MemberRow[],
  { geo, overrides = {}, file }: ImportOptions,
): ImportResult {
  const columns = resolveColumns(rows);
  const findings: Findings = {
    warnings: [],
    inferredStates: [],
    strippedPieces: [],
    unmatchedPieces: [],
    unknownProfessions: [],
    overridesApplied: [],
  };
  const context: Context = {
    index: countyNameIndex(geo),
    parseStates: createStateParser(geo),
    findings,
  };

  // Rule 1: skip empty rows.
  const filled = rows
    .map((row, index) => readRow(row, columns, index + 2))
    .filter((row) => FIELDS.some((field) => row[field] !== ''));

  // Rules 2 and 3: one member per email; rows that share an email are merged.
  const sources = groupByEmail(filled);
  const usedIds = new Set<string>();
  const built = sources.map((source) => buildMember(source, context, usedIds));
  const members = built.map(({ member }) => member);

  // Rule 12: overrides come last.
  applyOverrides(members, overrides, findings);

  const label = new Map(built.map(({ member, label }) => [member, label]));
  const nameOf = (member: Member) => label.get(member) ?? member.name;
  return {
    members,
    report: {
      file,
      rows: rows.length,
      emptyRowsSkipped: rows.length - filled.length,
      members: members.length,
      mergedMembers: built.filter(({ merged }) => merged).map(({ label }) => label),
      tiers: countTiers(members),
      searchable: countSearchable(members),
      notSearchable: members
        .filter((member) => !member.searchable)
        .map((member) => ({ name: nameOf(member), reasons: [...member.notSearchableReasons] })),
      badges: {
        cadp: members.filter((member) => member.badges.includes('cadp')).length,
        founding: members.filter((member) => member.badges.includes('founding')).map(nameOf),
      },
      ...findings,
    },
  };
}

/** A report for when there is nothing to import (for example, the file is missing). */
export function emptyImportReport(file: string, warnings: string[] = []): ImportReport {
  return {
    file,
    rows: 0,
    emptyRowsSkipped: 0,
    members: 0,
    mergedMembers: [],
    tiers: { silver: 0, gold: 0, platinum: 0, none: 0 },
    searchable: { total: 0, silver: 0, gold: 0, platinum: 0 },
    notSearchable: [],
    badges: { cadp: 0, founding: [] },
    inferredStates: [],
    strippedPieces: [],
    unmatchedPieces: [],
    unknownProfessions: [],
    overridesApplied: [],
    warnings,
  };
}

function groupByEmail(rows: readonly SourceRow[]): MemberSource[] {
  const sources: MemberSource[] = [];
  const byEmail = new Map<string, MemberSource>();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const existing = email ? byEmail.get(email) : undefined;
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    // Rows without an email can't be matched up, so each stays a member of its own.
    const source: MemberSource = { email, rows: [row] };
    sources.push(source);
    if (email) byEmail.set(email, source);
  }
  return sources;
}

/** Rules 2 and 4–11 for one member. `label` names the member in the report. */
function buildMember(
  source: MemberSource,
  { index, parseStates, findings }: Context,
  usedIds: Set<string>,
): { member: Member; label: string; merged: boolean } {
  const { rows, email } = source;
  const first = rows[0];
  const warn = (message: string) => findings.warnings.push(message);

  // Rule 3: the first row's name.
  const name = rows.find((row) => row.name)?.name ?? '';
  const label = name || `(no name, row ${first.number})`;
  if (!name) warn(`Row ${first.number}: no name, so this member is left out of search`);
  const otherNames = unique(rows.map((row) => row.name).filter((n) => n && n !== name));
  if (otherNames.length > 0) {
    warn(`${label}: rows with this email have other names too (${otherNames.join('; ')})`);
  }

  // Rule 2: the ID comes from the email (members without one get an ID from their name).
  const id = claimId(memberId(email || `no-email:${label}`), usedIds);

  // Rule 4: the tier; merged rows keep the highest.
  let tier: Tier | null = null;
  for (const row of rows) {
    const parsed = parseTier(row.tier);
    if (!parsed.known) warn(`${label}: unknown membership tier "${row.tier}", treated as no tier`);
    tier = higherTier(tier, parsed.tier);
  }

  // Rule 5: professions, the CADP badge and the supporter flag.
  const labels = unique(
    rows.flatMap((row) => splitValues(row.professions)),
    normalizeLabel,
  );
  const professions = parseProfessions(labels);
  for (const unknown of professions.unknown) {
    findings.unknownProfessions.push({ member: label, label: unknown.label });
    warn(
      unknown.parent
        ? `${label}: unknown profession "${unknown.label}", counted as "${unknown.parent}"`
        : `${label}: unknown profession "${unknown.label}", ignored`,
    );
  }

  // Rule 6: states, and non-US values.
  const states = parseStates(
    unique(
      rows.flatMap((row) => splitStates(row.states)),
      normalizeName,
    ),
  );
  for (const value of states.unknown) warn(`${label}: unknown state "${value}", ignored`);
  const outsideUS = states.outsideUS.length > 0;

  // Rule 7: counties, matched in the member's states (all states when no state is given).
  const searchStates = states.codes.length > 0 ? states.codes : outsideUS ? [] : index.allStates;
  const pieces = unique(
    rows.flatMap((row) => splitValues(row.counties)),
    (piece) => piece.replace(/\s+/g, ' ').toLowerCase(),
  );
  let counties: County[] = [];
  const statesPerPiece: Array<ReadonlySet<string>> = [];
  for (const piece of pieces) {
    const match = matchCountyPiece(index, piece, searchStates);
    if (!match) {
      findings.unmatchedPieces.push({ member: label, piece });
      warn(
        `${label}: "${piece}" matches no county in ${describeStates(searchStates, index)}; dropped`,
      );
      continue;
    }
    if (match.stripped)
      findings.strippedPieces.push({ member: label, before: piece, after: match.text });
    counties.push(...match.counties);
    statesPerPiece.push(new Set(match.counties.map((county) => county.state)));
  }
  counties = unique(counties, (county) => county.fips);

  // Rule 8: no state, but counties: the single state that has all of them.
  let stateCodes = states.codes;
  let inferredState: string | null = null;
  if (stateCodes.length === 0 && counties.length > 0) {
    const common = intersection(statesPerPiece);
    if (common.length === 1 && common[0]) {
      const state = common[0];
      inferredState = state;
      stateCodes = [state];
      counties = counties.filter((county) => county.state === state);
      findings.inferredStates.push({ name: label, state });
      warn(`${label}: no state given; inferred ${state} from the counties`);
    } else {
      warn(`${label}: no state given, and no single state has all of the counties`);
    }
  }

  // Rule 9 (Platinum is statewide) is applied by matching: counties are kept but not used.

  // Rule 10: badges.
  const badges: Member['badges'] = [];
  if (professions.cadp) badges.push('cadp');
  if (rows.some((row) => isYes(row.founding))) badges.push('founding');

  // Rule 11: searchable, or the reasons why not.
  const hasEmail = email !== '' && isValidEmail(email);
  if (!email) warn(`${label}: no email (row ${first.number})`);
  else if (!hasEmail) warn(`${label}: "${email}" is not a valid email address`);

  const reasons: NotSearchableReason[] = [];
  if (!tier) reasons.push('no_tier');
  if (!professions.hasProfession)
    reasons.push(professions.supporter ? 'supporter_only' : 'no_profession');
  if (stateCodes.length === 0) reasons.push(outsideUS ? 'outside_us' : 'no_us_state');
  if (!hasEmail) reasons.push('no_email');
  // Counties only matter once there is a tier below Platinum and a state to have them in.
  if (tier && tier !== 'platinum' && stateCodes.length > 0 && counties.length === 0) {
    reasons.push('no_counties');
  }
  // A card needs a name; there is no reason code for that yet, so it counts as excluded.
  if (!name) reasons.push('excluded');

  const searchable = reasons.length === 0;
  if (searchable && professions.professions.length === 0) {
    const umbrella = labels.filter((l) => classifyLabel(l).kind === 'umbrella');
    warn(
      `${label}: ${umbrella.map((l) => `"${l}"`).join(' and ')} on its own matches no kind of professional, so this member won't appear in any search`,
    );
  }

  const member: Member = {
    id,
    name,
    email,
    tier,
    professions: professions.professions,
    states: stateCodes,
    counties: counties.map((county) => county.fips),
    badges,
    supporter: professions.supporter,
    outsideUS,
    inferredState,
    searchable,
    notSearchableReasons: reasons,
    active: true,
  };
  return { member, label, merged: rows.length > 1 };
}

/** Rule 12: { "email": { "exclude": true, "reason": "…" } }. */
function applyOverrides(members: Member[], overrides: MemberOverrides, findings: Findings): void {
  const byEmail = new Map(members.filter((m) => m.email).map((m) => [m.email, m]));
  for (const [email, override] of Object.entries(overrides)) {
    const member = byEmail.get(email);
    if (!member) {
      findings.warnings.push(`member-overrides.json: no member has the email ${email}`);
      continue;
    }
    if (!override.exclude) continue;
    member.searchable = false;
    if (!member.notSearchableReasons.includes('excluded')) {
      member.notSearchableReasons.push('excluded');
    }
    findings.overridesApplied.push({
      email,
      action: override.reason ? `exclude (${override.reason})` : 'exclude',
    });
  }
}

/** Member IDs must be unique; a clash (rows without an email, same name) gets a suffix. */
function claimId(id: string, usedIds: Set<string>): string {
  let unique = id;
  for (let n = 2; usedIds.has(unique); n += 1) unique = `${id}_${n}`;
  usedIds.add(unique);
  return unique;
}

/** The states every set contains. */
function intersection(sets: ReadonlyArray<ReadonlySet<string>>): string[] {
  const [first, ...rest] = sets;
  if (!first) return [];
  return [...first].filter((value) => rest.every((set) => set.has(value)));
}

function describeStates(states: readonly string[], index: CountyNameIndex): string {
  if (states.length === 0) return 'a US state (none listed)';
  if (states.length === index.allStates.length) return 'any state';
  return states.join(', ');
}

function countTiers(members: readonly Member[]): ImportReport['tiers'] {
  const tiers = { silver: 0, gold: 0, platinum: 0, none: 0 };
  for (const member of members) tiers[member.tier ?? 'none'] += 1;
  return tiers;
}

function countSearchable(members: readonly Member[]): ImportReport['searchable'] {
  const searchable = { total: 0, silver: 0, gold: 0, platinum: 0 };
  for (const member of members) {
    if (!member.searchable || !member.tier) continue;
    searchable.total += 1;
    searchable[member.tier] += 1;
  }
  return searchable;
}
