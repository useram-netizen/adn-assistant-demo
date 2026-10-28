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
  ['bankruptcy_attorney', /\b(?:bankrupt\w*)\b/i],
  ['qdro_attorney', /\b(?:qdros?\b|qualified domestic relations order)/i],
  ['estate_attorney', /\b(?:estate[- ]plann\w*|wills? and trusts?|estate (?:attorney|lawyer))/i],
  ['paralegal', /\b(?:paralegal\w*|document prep\w*|legal docs?\b)\b/i],
  ['parenting_coordinator', /\b(?:parent(?:ing)? coordinator\w*|parenting coordination)\b/i],
  ['arbitrator', /\b(?:arbitrat\w*)\b/i],
  [
    'mediator',
    /\b(?:mediat\w*|meditator|dispute resolution|settle(?:ment)?|collaborative (?:divorce|law)|peaceful resolution)\b/i,
  ],
  [
    'financial',
    /\b(?:cdfa\b|financial\w*|finance\w*|accountant\w*|cpa\b|forensic|wealth|planner\b|pension\w*|401k|retirement split|tax advice|property division|division of assets?|asset division|asset split|assets?|debt)\b/i,
  ],
  [
    'real_estate',
    /\b(?:realtor\w*|real estate|mortgage\w*|apprais\w*|home valuation|house|sell(?:ing)? (?:the )?(?:house|home)|refinanc\w*|equity)\b/i,
  ],
  [
    'therapist',
    /\b(?:therap\w*|thearpist|therepist|counsell?or\w*|counsell?ing\b|psycholog\w*|psychiatr\w*|mental health|emotional (?:support|help)|trauma|coping|grief|stress)\b/i,
  ],
  ['coach', /\b(?:coach\w*|divorce coach\w*|life coach\w*|guidance|transition coach)\b/i],
  [
    'attorney',
    /\b(?:attorney\w*|atorney|attourney|attorny|lawyer\w*|lawer|counsel\b|legal (?:help|advice|rep|representation)|litigat\w*|family law\w*|custody (?:lawyer|attorney)|divorce (?:lawyer|attorney)|law firm)\b/i,
  ],
];

/** "my lawyer", "our divorce mediator": one they already have, not one they are looking for. */
const ALREADY_HAVE = /\b(?:my|our|his|her|their)\s+(?:[\p{L}-]+\s+)?$/u;

/** The kind of professional the text asks for, or null. */
export function categoryFromText(text: string): CategoryKey | null {
  const all = allCategoriesFromText(text);
  return all[0] ?? null;
}

/** Finds all distinct matching professional categories in the text, ordered by appearance. */
export function allCategoriesFromText(text: string): CategoryKey[] {
  const lower = text.toLowerCase();
  const matched = new Map<CategoryKey, number>();
  for (const [key, pattern] of CATEGORY_WORDS) {
    const globalPattern = new RegExp(pattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(lower)) !== null) {
      if (ALREADY_HAVE.test(lower.slice(Math.max(0, match.index - 30), match.index))) {
        continue;
      }
      matched.set(key, match.index);
      break;
    }
  }
  // If a specific attorney subtype matched, don't count generic attorney unless another mention exists
  if (
    matched.has('attorney') &&
    (matched.has('bankruptcy_attorney') ||
      matched.has('qdro_attorney') ||
      matched.has('estate_attorney'))
  ) {
    const genericPattern = /\b(?:attorney\w*|atorney|attourney|attorny|lawyer\w*|lawer|legal\b)/gi;
    let count = 0;
    while (genericPattern.exec(lower) !== null) count++;
    if (count <= 1) {
      matched.delete('attorney');
    }
  }
  return Array.from(matched.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => key);
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

const HELLO =
  /^\s*(?:hi|hello|hey|hiya|howdy|good (?:morning|afternoon|evening))\b[\s!.,]*(?:there|again)?[\s!.,]*$/;
const THANKS = /\b(?:thanks|thank you|thx|cheers)\b/;
const ABOUT =
  /\bwhat (?:can|do|could) you do\b|\bhow (?:does|do) (?:this|it|you) work\b|\bwhat is this\b|\bwhat(?:'s| is) this (?:for|about)\b|\bwho are you\b|\bwhat are you\b|\bhow can you help\b|\bwhat do you offer\b/;

/** An everyday message with a ready reply: a greeting, thanks, or "what can you do?". */
export function everydayMessage(text: string): 'hello' | 'thanks' | 'about' | null {
  const lower = text.toLowerCase().replace(/[’]/g, "'");
  if (ABOUT.test(lower)) return 'about';
  if (HELLO.test(lower)) return 'hello';
  if (THANKS.test(lower) && lower.length < 40) return 'thanks';
  return null;
}

const NOT_SURE_WORDS = /\b(?:not sure|unsure|don'?t know|no idea|help me choose|recommend)\b/i;

/** What the text says, without the AI: an option of the step (or null) and the hints. */
export function keywordInterpret(
  spec: StepSpec,
  text: string,
  geo: Geo,
  candidateCategories?: CategoryKey[],
): {
  optionId: string | null;
  hints: InterpretHints;
  reply?: string;
  categories?: CategoryKey[];
} {
  let allCategories = allCategoriesFromText(text);
  const lower = text.toLowerCase();
  if (
    allCategories.length === 0 &&
    candidateCategories &&
    candidateCategories.length > 0 &&
    /\b(?:both|either|all of (?:the above|them)|all)\b/i.test(lower)
  ) {
    allCategories = candidateCategories;
  }
  const hints: InterpretHints = {
    category: allCategories[0] ?? null,
    categories: allCategories.length > 1 ? allCategories : undefined,
    ...placeFromText(text, geo),
  };
  let optionId: string | null = null;
  let reply: string | undefined = undefined;
  let categories: CategoryKey[] | undefined = undefined;

  switch (spec.step) {
    case 'welcome':
      optionId = welcomeFromText(text);
      break;
    case 'location':
      optionId = hints.state;
      break;
    case 'category':
    case 'category_more':
    case 'category_help': {
      if (everydayMessage(text)) {
        optionId = null;
        break;
      }
      if (NOT_SURE_WORDS.test(lower) && allCategories.length === 0) {
        optionId = 'not_sure';
        break;
      }
      if (allCategories.length >= 1) {
        optionId = allCategories[0] ?? null;
        if (allCategories.length > 1) {
          categories = allCategories;
        }
      } else {
        optionId = null;
        reply =
          "I couldn't quite tell which kind of professional you need. You can type what you need (such as legal advice, mediation, financial guidance, emotional support, or real estate).";
      }
      break;
    }
    default:
      break;
  }
  const offered = optionId !== null && spec.options.some((option) => option.id === optionId);
  return { optionId: offered ? optionId : null, hints, reply, categories };
}
