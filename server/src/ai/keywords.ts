import type { CategoryKey } from '../config/taxonomy.js';
import type { Geo } from '../domain/types.js';
import type { InterpretHints } from './calls.js';
import type { StepSpec } from './options.js';

/**
 * Typed text understood without the AI, for when it is off, failing or over a limit: keywords
 * for the kind of professional, the welcome step's two answers, US state names and a few big
 * cities. The AI is better at all of this; this only keeps the most common requests working
 * ("I need a divorce attorney" should never get "Sorry, I didn't catch that"). Every answer is
 * one of the step's options or a real key or code (rule 3), and the visitor confirms it.
 */

/** The kinds of professional, most specific first ("bankruptcy attorney" before "attorney"). */
const CATEGORY_WORDS: ReadonlyArray<readonly [CategoryKey, RegExp]> = [
  ['bankruptcy_attorney', /\bbankrupt/],
  ['qdro_attorney', /\bqdros?\b/],
  ['estate_attorney', /\bestate[- ]plann|\bwills? and trusts?\b|\bestate (?:attorney|lawyer)/],
  ['paralegal', /\bparalegal|\bdocument prep/],
  ['parenting_coordinator', /\bparent(?:ing)? coordinator/],
  ['arbitrator', /\barbitrat/],
  ['mediator', /\bmediat/],
  ['financial', /\bcdfa\b|\bfinancial\b|\baccountant|\bcpa\b|\bforensic|\bplanner\b/],
  ['real_estate', /\brealtor|\breal estate|\bmortgage|\bappraiser\b/],
  ['therapist', /\btherap|\bcounsell?or\b|\bcounsell?ing\b|\bpsycholog|\bmental health/],
  ['coach', /\bcoach/],
  ['attorney', /\battorney|\blawyer|\blegal (?:help|advice|representation)/],
];

/** "my lawyer", "our divorce mediator": one they already have, not one they are looking for. */
const ALREADY_HAVE = /\b(?:my|our|his|her|their)\s+(?:[\p{L}-]+\s+)?$/u;

/** The kind of professional the text asks for, or null. */
export function categoryFromText(text: string): CategoryKey | null {
  const lower = text.toLowerCase();
  for (const [key, pattern] of CATEGORY_WORDS) {
    const match = pattern.exec(lower);
    if (!match) continue;
    if (ALREADY_HAVE.test(lower.slice(Math.max(0, match.index - 30), match.index))) continue;
    return key;
  }
  return null;
}

const PROFESSIONS =
  '(?:(?:divorce|family|certified|licensed|financial)\\s+)?(?:attorney|lawyer|mediator|therapist|counsell?or|coach|cdfa|accountant|realtor|paralegal|arbitrator|planner)';
/** "I'm a mediator", "I am a family lawyer": a professional, probably here to join. */
const I_AM_A_PROFESSIONAL = new RegExp(`\\bi(?:['’]m| am| m) an?\\s+${PROFESSIONS}\\b`);
const JOINING =
  /\b(?:join|joining|membership|become a member|sign up as|list my (?:practice|firm|services))\b/;
/** Their own divorce or separation. */
const DIVORCE_WORDS =
  /\bdivorc|\bseparat|\bcustody|\bspouse|\bhusband|\bwife\b|\bmarriage|\bmarried|\bsplit(?:ting)? up\b|\bco-?parent|\bchild support|\balimony/;

/** At the welcome step: a visitor going through a divorce, a professional, or null. */
export function welcomeFromText(text: string): 'divorce' | 'professional' | null {
  const lower = text.toLowerCase();
  if (JOINING.test(lower) || I_AM_A_PROFESSIONAL.test(lower)) return 'professional';
  if (categoryFromText(lower) || DIVORCE_WORDS.test(lower)) return 'divorce';
  return null;
}

/** Big cities whose state is not in doubt (no Portland, Kansas City or Springfield). */
const CITIES: ReadonlyArray<readonly [string, string]> = [
  ['washington dc', 'DC'],
  ['washington d.c.', 'DC'],
  ['district of columbia', 'DC'],
  ['new york city', 'NY'],
  ['nyc', 'NY'],
  ['brooklyn', 'NY'],
  ['manhattan', 'NY'],
  ['boston', 'MA'],
  ['atlanta', 'GA'],
  ['chicago', 'IL'],
  ['houston', 'TX'],
  ['dallas', 'TX'],
  ['san antonio', 'TX'],
  ['fort worth', 'TX'],
  ['los angeles', 'CA'],
  ['san francisco', 'CA'],
  ['san diego', 'CA'],
  ['san jose', 'CA'],
  ['sacramento', 'CA'],
  ['miami', 'FL'],
  ['orlando', 'FL'],
  ['tampa', 'FL'],
  ['jacksonville', 'FL'],
  ['philadelphia', 'PA'],
  ['pittsburgh', 'PA'],
  ['seattle', 'WA'],
  ['denver', 'CO'],
  ['las vegas', 'NV'],
  ['detroit', 'MI'],
  ['minneapolis', 'MN'],
  ['raleigh', 'NC'],
  ['nashville', 'TN'],
  ['memphis', 'TN'],
  ['baltimore', 'MD'],
  ['indianapolis', 'IN'],
  ['new orleans', 'LA'],
  ['salt lake city', 'UT'],
  ['st. louis', 'MO'],
  ['st louis', 'MO'],
  ['milwaukee', 'WI'],
  ['oklahoma city', 'OK'],
  ['albuquerque', 'NM'],
];

/** "st. louis" → "St. Louis". */
function titleCase(text: string): string {
  return text.replace(
    /(^|\s)(\p{L})/gu,
    (_match, space: string, letter: string) => space + letter.toUpperCase(),
  );
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordPattern(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}])${escape(name)}(?![\\p{L}])`, 'u');
}

/** The first match, longest names first ("west virginia" before "virginia"). */
function findName(lower: string, names: ReadonlyArray<readonly [string, string]>) {
  const sorted = [...names].sort((a, b) => b[0].length - a[0].length);
  for (const [name, code] of sorted) {
    const match = wordPattern(name).exec(lower);
    if (match) return { code, text: match[0] };
  }
  return null;
}

/** A US state (by its name, or a big city's), and the city or ZIP code as the place. */
export function placeFromText(
  text: string,
  geo: Geo,
): { state: string | null; place: string | null } {
  const lower = text.toLowerCase();
  const city = findName(lower, CITIES);
  if (city) return { state: city.code, place: city.code === 'DC' ? null : titleCase(city.text) };
  const state = findName(
    lower,
    geo.states().map((item) => [item.name.toLowerCase(), item.code] as const),
  );
  const zip = /(?<!\d)\d{5}(?!\d)/.exec(text)?.[0] ?? null;
  return { state: state?.code ?? null, place: zip };
}

/** What the text says, without the AI: an option of the step (or null) and the hints. */
export function keywordInterpret(
  spec: StepSpec,
  text: string,
  geo: Geo,
): { optionId: string | null; hints: InterpretHints } {
  const hints: InterpretHints = { category: categoryFromText(text), ...placeFromText(text, geo) };
  let optionId: string | null = null;
  switch (spec.step) {
    case 'welcome':
      optionId = welcomeFromText(text);
      break;
    case 'location':
      optionId = hints.state;
      break;
    case 'category':
    case 'category_more':
    case 'category_help':
      optionId = hints.category;
      break;
    default:
      break;
  }
  const offered = optionId !== null && spec.options.some((option) => option.id === optionId);
  return { optionId: offered ? optionId : null, hints };
}
