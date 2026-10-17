/**
 * Server-side domain types and the interfaces between modules. Each module implements one
 * interface and receives the others through AppDeps, so routes can be tested with fakes.
 * See docs/ARCHITECTURE.md.
 */
import type { CategoryKey, SheetLabel, StageKey, Tier } from '../config/taxonomy.js';
import type { EventDataByType, EventType } from '../shared/api.js';

// ---------------------------------------------------------------- Geography (data/us-counties-2020.csv)

export interface StateInfo {
  /** USPS code, for example "GA". The 50 states + DC. */
  code: string;
  name: string;
}

export interface County {
  /** 5-digit FIPS code, for example "13121". */
  fips: string;
  /** USPS state code. */
  state: string;
  /** Full name as in the Census list, for example "Fulton County" or "Baltimore city". */
  name: string;
  /** Old or alternate names, only for matching text in the member list. */
  aliases: string[];
}

export interface Geo {
  /** The 50 states + DC, sorted by name. */
  states(): readonly StateInfo[];
  state(code: string): StateInfo | undefined;
  /** The counties of a state, sorted by name. Empty for an unknown state. */
  counties(stateCode: string): readonly County[];
  county(fips: string): County | undefined;
  /** "Fulton County" → "Fulton" (only " County" and " Parish" are dropped), for result cards. */
  shortCountyName(county: County): string;
}

// ---------------------------------------------------------------- Members (data/members.csv, in memory)

export interface MemberProfession {
  /** The canonical sheet label from taxonomy.ts. */
  label: SheetLabel;
  category: CategoryKey;
  /** null = the parent label (matches the category with "Any" subtype only). */
  subtype: string | null;
}

export type NotSearchableReason =
  | 'no_tier'
  | 'no_profession'
  | 'no_email'
  | 'no_us_state'
  | 'outside_us'
  | 'supporter_only'
  | 'no_counties'
  | 'excluded';

export interface Member {
  /** "m_" + the first 12 hex characters of sha1(trimmed, lower-case email). */
  id: string;
  name: string;
  /** Trimmed and lower-cased. Never sent to the widget unless SHOW_PRO_CONTACT=true. */
  email: string;
  tier: Tier | null;
  professions: MemberProfession[];
  /** USPS codes. */
  states: string[];
  /** FIPS codes (not used for matching Platinum members, who are statewide). */
  counties: string[];
  badges: Array<'cadp' | 'founding'>;
  supporter: boolean;
  /** Had a non-US value in State(s) (CANADA, New Brunswick). */
  outsideUS: boolean;
  /** Set when the state was inferred from the counties (import rule 8). */
  inferredState: string | null;
  searchable: boolean;
  /** Why the member is not searchable (empty when searchable). */
  notSearchableReasons: NotSearchableReason[];
  /** Always true while members come from the file (no --sync). */
  active: boolean;
}

/** The import's report (npm run import -- data/members.csv prints it). */
export interface ImportReport {
  file: string;
  rows: number;
  emptyRowsSkipped: number;
  members: number;
  /** Names of members built from more than one row (merged by email). */
  mergedMembers: string[];
  tiers: { silver: number; gold: number; platinum: number; none: number };
  searchable: { total: number; silver: number; gold: number; platinum: number };
  notSearchable: Array<{ name: string; reasons: NotSearchableReason[] }>;
  badges: { cadp: number; founding: string[] };
  inferredStates: Array<{ name: string; state: string }>;
  /** County pieces that had extra text in front: before → after. */
  strippedPieces: Array<{ member: string; before: string; after: string }>;
  /** County pieces that matched no county in the member's states (dropped). */
  unmatchedPieces: Array<{ member: string; piece: string }>;
  unknownProfessions: Array<{ member: string; label: string }>;
  overridesApplied: Array<{ email: string; action: string }>;
  warnings: string[];
}

export interface MatchInput {
  state: string;
  countyFips: string;
  category: CategoryKey;
  /** A specific subtype, or null for "Any". */
  subcategory: string | null;
}

export interface MemberDirectory {
  readonly loadedAt: Date;
  readonly report: ImportReport;
  all(): readonly Member[];
  get(id: string): Member | undefined;
  /** Searchable, active members for the input: Platinum, then Gold, then Silver, each tier
   *  shuffled with a seed (the session ID) so the order is stable for one visitor. */
  match(input: MatchInput, seed: string): Member[];
  /** Re-reads the members file. Keeps the current list if the file can't be read. */
  reload(): Promise<void>;
}

// ---------------------------------------------------------------- Storage (MongoDB if MONGODB_URI, else JSON files)

export type RecipientKind = 'professional' | 'client' | 'tracy' | 'copy';

export interface LeadRecipient {
  kind: RecipientKind;
  memberId?: string;
  /** The real address the email is meant for (in redirect mode it went to EMAIL_REDIRECT_TO). */
  to: string;
  status: 'pending' | 'sent' | 'previewed' | 'failed';
  attempts: number;
  /** Error code or short message (never personal details). */
  lastError?: string;
  updatedAt: string;
}

export interface Lead {
  id: string;
  kind: 'pros' | 'tracy';
  createdAt: string;
  sessionId: string;
  site: string;
  reason: 'no_match' | 'outside' | null;
  state: string | null;
  countyFips: string | null;
  county: string | null;
  category: CategoryKey | null;
  subcategory: string | null;
  stage: StageKey | null;
  memberIds: string[];
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    preferredContact: 'email' | 'phone';
  };
  message: string;
  recipients: LeadRecipient[];
}

export interface GapRecord {
  createdAt: string;
  site: string;
  state: string;
  countyFips: string;
  county: string;
  category: CategoryKey;
  subcategory: string | null;
}

export interface EventRecord<T extends EventType = EventType> {
  sessionId: string;
  site: string;
  type: T;
  data: EventDataByType[T];
  /** When it happened (the visitor's clock for widget events). */
  at: string;
  receivedAt: string;
  source: 'client' | 'server';
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface Store {
  readonly kind: 'mongo' | 'file' | 'memory';
  /** Never throws: a missing or unreachable database is logged, not fatal. */
  init(): Promise<void>;
  saveLead(lead: Lead): Promise<void>;
  updateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<void>;
  saveGap(gap: GapRecord): Promise<void>;
  saveEvents(events: EventRecord[]): Promise<void>;
  listLeads(range?: DateRange): Promise<Lead[]>;
  listGaps(range?: DateRange): Promise<GapRecord[]>;
  listEvents(range?: DateRange): Promise<EventRecord[]>;
  /** Lead retention (LEAD_RETENTION_DAYS). Returns how many were deleted. */
  deleteLeadsBefore(cutoff: Date): Promise<number>;
  close(): Promise<void>;
}

/** Records server-side events without blocking the request (errors are logged). */
export interface EventSink {
  record<T extends EventType>(event: {
    sessionId: string;
    site: string;
    type: T;
    data: EventDataByType[T];
  }): void;
}

// ---------------------------------------------------------------- Email

export type EmailMode = 'preview' | 'redirect' | 'live';

export interface OutgoingEmail {
  kind: RecipientKind | 'client_tracy';
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  status: 'sent' | 'previewed';
  /** preview mode: the file the HTML was saved to. */
  file?: string;
}

export interface Mailer {
  readonly mode: EmailMode;
  /** preview: saves the HTML to server/.mail-preview/; redirect: sends to EMAIL_REDIRECT_TO;
   *  live: sends to `to`. Throws when sending fails. */
  send(email: OutgoingEmail): Promise<SendResult>;
}
