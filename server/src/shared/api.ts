/**
 * The HTTP API between the widget and the server: request and response shapes.
 * Types only (the widget imports this file as `@adn/api` with `import type`).
 * The server validates every request with zod; these types describe what passes.
 */
import type { CategoryKey, StageKey, Tier } from '../config/taxonomy.js';

/** Error responses: { error: code }. Validation errors may list the bad fields. */
export interface ApiError {
  error:
    | 'bad_request'
    | 'validation_failed'
    | 'not_found'
    | 'rate_limited'
    | 'not_in_match'
    | 'payload_too_large'
    | 'invalid_json'
    | 'server_error'
    | 'admin_disabled'
    | 'unauthorized';
  fields?: string[];
}

// ---------------------------------------------------------------- GET /api/config

export interface PublicConfigResponse {
  /** OPEN links; null while unset (the widget hides them). */
  links: {
    join: string | null;
    ukSite: string | null;
    articles: string | null;
    podcast: string | null;
    booking: string | null;
    privacy: string | null;
  };
  features: {
    /** AI_ENABLED and an OpenAI key is configured. The widget works either way. */
    ai: boolean;
    /** SHOW_PRO_CONTACT: result cards show the professional's email. */
    showProContact: boolean;
  };
}

// ---------------------------------------------------------------- GET /api/states, /api/counties

export interface StateOption {
  /** USPS code, for example "GA". */
  code: string;
  name: string;
}
export interface StatesResponse {
  states: StateOption[]; // the 50 states + DC, sorted by name
}

export interface CountyOption {
  /** 5-digit FIPS code, for example "13121". */
  fips: string;
  /** Full name, for example "Fulton County". */
  name: string;
}
/** GET /api/counties?state=GA */
export interface CountiesResponse {
  state: string;
  counties: CountyOption[]; // sorted by name
}

// ---------------------------------------------------------------- POST /api/match

/** "any" (or null/omitted) = the whole category. */
export interface MatchRequest {
  sessionId: string;
  site: string;
  state: string;
  countyFips: string;
  category: CategoryKey;
  subcategory?: string | null;
}

export type CardBadge = 'platinum' | 'gold' | 'cadp' | 'founding';

export interface ProfessionalCard {
  id: string;
  name: string;
  tier: Tier;
  /** Display labels, the requested kind first. */
  labels: string[];
  /** "Serves all of Georgia" or "Serves Fulton, Cobb, DeKalb + 2 more". */
  serviceArea: string;
  /** Silver gets no tier badge. */
  badges: CardBadge[];
  /** Only when SHOW_PRO_CONTACT=true. */
  email?: string;
}

export interface MatchResponse {
  /** All matches, Platinum first, then Gold, then Silver (each tier shuffled per session). */
  results: ProfessionalCard[];
  total: number;
  noMatch: boolean;
  counts: Record<Tier, number>;
}

// ---------------------------------------------------------------- POST /api/ai/*

/** Steps where typed text is interpreted against the step's options. */
export type InterpretStep =
  | 'welcome'
  | 'location'
  | 'county'
  | 'stage'
  | 'category'
  | 'category_more'
  | 'category_help'
  | 'subcategory'
  /** Any other step: the text can only be a question or unclear. */
  | 'other';

/**
 * Option ids per step (the server builds the options itself; rule 3):
 * welcome: divorce | professional
 * location: a state code (GA) | uk | outside
 * county: a FIPS code in `state` | not_sure
 * stage: a StageKey
 * category: a CategoryKey | more | not_sure
 * category_more, category_help: a CategoryKey
 * subcategory: a subtype of `category` | any
 */
export interface InterpretRequest {
  sessionId: string;
  site: string;
  step: InterpretStep;
  text: string; // 1..1000 characters
  /** Required for step "county". */
  state?: string;
  /** Required for step "subcategory". */
  category?: CategoryKey;
}

export interface InterpretResponse {
  kind: 'option' | 'question' | 'unclear';
  /** Always one of the step's option ids, or null. */
  optionId: string | null;
  /** A short reply (≤50 words); for "question", the answer to show. May be empty. */
  reply: string;
  /** Show the safety card (keyword match or the AI's safety_concern). */
  safety: boolean;
  /** The text tells us about the visitor's situation: keep it as their situation. */
  sharesSituation: boolean;
  /** exact = matched an option's name without AI (no need to confirm). */
  source: 'exact' | 'ai' | 'fallback';
}

export interface CountyFromPlaceRequest {
  sessionId: string;
  site: string;
  state: string;
  text: string; // a city, town or ZIP code
}

export interface CountyFromPlaceResponse {
  /** A county in `state`, or null (then the widget shows the dropdown). */
  countyFips: string | null;
  countyName: string | null;
  confidence: 'high' | 'low';
  reply: string;
  safety: boolean;
  /** exact = the text was a county's name (no AI call). */
  source: 'exact' | 'ai' | 'fallback';
}

export interface SituationRequest {
  sessionId: string;
  site: string;
  stage: StageKey | null;
  text: string; // 1..1000 characters
}

export interface SituationResponse {
  /** An acknowledgement (≤40 words). */
  reply: string;
  /** 0–3 valid category keys. */
  suggestedCategories: CategoryKey[];
  /** ≤60 words, neutral, third person, no names; pre-fills the contact form message.
   *  With the fallback it is the visitor's own text. */
  summary: string;
  safety: boolean;
  source: 'ai' | 'fallback';
}

export interface RecommendRequest {
  sessionId: string;
  site: string;
  stage: StageKey | null;
  summary: string | null;
}

export interface RecommendResponse {
  /** 1–3 recommendations; empty with the fallback (the widget shows the static explanations). */
  recommendations: Array<{ category: CategoryKey; reason: string }>;
  reply: string;
  source: 'ai' | 'fallback';
}

// ---------------------------------------------------------------- POST /api/leads, /api/contact-tracy

export interface ContactFields {
  firstName: string; // 1..80
  lastName: string; // 1..80
  email: string;
  phone?: string | null; // optional, required when preferredContact is "phone"
  preferredContact: 'email' | 'phone';
  message: string; // 1..1500
  consent: true;
  /** Honeypot: hidden from people. If filled, the server pretends success and sends nothing. */
  website?: string;
}

export interface LeadRequest extends ContactFields {
  sessionId: string;
  site: string;
  state: string;
  countyFips: string;
  category: CategoryKey;
  subcategory?: string | null;
  stage?: StageKey | null;
  /** 1–5 members from the visitor's results (checked against a fresh match). */
  memberIds: string[];
}

export interface LeadResponse {
  ok: true;
  /** Names of the professionals the request went to. */
  contacted: string[];
  /** The message matched the safety keywords. */
  safety: boolean;
}

export interface TracyRequest extends ContactFields {
  sessionId: string;
  site: string;
  /** no_match: nobody covers the visitor's county; outside: not in the US or UK. */
  reason: 'no_match' | 'outside';
  state?: string | null;
  countyFips?: string | null;
  category?: CategoryKey | null;
  subcategory?: string | null;
  stage?: StageKey | null;
}

export interface TracyResponse {
  ok: true;
  safety: boolean;
}

// ---------------------------------------------------------------- POST /api/events

/** Option values only, never text the visitor typed (spec: Tracking). */
export interface EventDataByType {
  session_started: { mode: 'inline' | 'bubble' | 'standalone' };
  step_viewed: { step: string };
  answer: { step: string; value: string };
  branch: { branch: 'pro' | 'uk' | 'outside' };
  /** Recorded by the server only. */
  ai_call: { kind: 'interpret' | 'county' | 'situation' | 'recommend'; ms: number; ok: boolean; tokens: number };
  results_shown: { platinum: number; gold: number; silver: number; total: number; category: string; state: string };
  no_match: { category: string; state: string; countyFips: string };
  pros_selected: { count: number };
  /** Recorded by the server only. */
  lead_submitted: { count: number; category: string };
  /** Recorded by the server only. */
  tracy_form_submitted: { reason: 'no_match' | 'outside' };
  /** Recorded by the server only. */
  email_failed: { kind: string; attempts: number };
  link_clicked: { link: 'join' | 'uk_site' | 'articles' | 'podcast' | 'booking' | 'privacy' | 'safety' };
  safety_shown: { trigger: 'keyword' | 'ai' };
}

export type EventType = keyof EventDataByType;

/** Event types the widget may send; the rest are recorded by the server. */
export const CLIENT_EVENT_TYPES = [
  'session_started',
  'step_viewed',
  'answer',
  'branch',
  'results_shown',
  'no_match',
  'pros_selected',
  'link_clicked',
  'safety_shown',
] as const satisfies readonly EventType[];

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export interface ClientEvent<T extends ClientEventType = ClientEventType> {
  type: T;
  data: EventDataByType[T];
  /** ISO time on the visitor's device. */
  at: string;
}

export interface EventsRequest {
  sessionId: string; // a random UUID kept in memory
  site: string;
  events: ClientEvent[]; // 1..50
}
