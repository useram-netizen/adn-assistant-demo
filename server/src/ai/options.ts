import { copy, fill } from '../config/copy.js';
import {
  CATEGORY_KEYS,
  MORE_CATEGORIES,
  STAGE_KEYS,
  SUBTYPES,
  hasSubtypes,
  type CategoryKey,
} from '../config/taxonomy.js';
import type { County, Geo } from '../domain/types.js';
import type { InterpretStep, StepId } from '../shared/api.js';
import { matchKey } from './text.js';

/**
 * The options of each step where typed text is interpreted. The server builds them from geo,
 * the taxonomy and copy (rule 3): the AI only ever picks one of these ids, and an exact match
 * on a name skips the AI altogether.
 */

// Typed as a Record so a step added to InterpretStep (shared/api.ts) must be listed here too.
const STEPS: Record<InterpretStep, true> = {
  welcome: true,
  location: true,
  county: true,
  stage: true,
  category: true,
  category_more: true,
  category_help: true,
  subcategory: true,
  other: true,
};

/** Every InterpretStep, for validating requests. */
export const INTERPRET_STEPS = Object.keys(STEPS) as [InterpretStep, ...InterpretStep[]];

export interface StepOption {
  /** What the widget receives. */
  id: string;
  /** Sent to the AI together with the id. */
  label: string;
  /** Exact-match keys (from matchKey) for the label, the id and other names. Never sent to the AI. */
  keys: readonly string[];
}

export interface StepSpec {
  step: InterpretStep;
  /** What the assistant asked at this step; null at "other". */
  question: string | null;
  options: readonly StepOption[];
}

export interface StepContext {
  /** USPS code: the county step's state. */
  state?: string;
  /** The subcategory step's category. */
  category?: CategoryKey;
}

/**
 * State codes that are also everyday words or names ("ok", "hi", "LA" for Los Angeles). Typed on
 * their own they go to the AI, which asks "Did you mean…?", instead of being taken as the state.
 */
const AMBIGUOUS_STATE_CODES: ReadonlySet<string> = new Set([
  'HI',
  'IN',
  'LA',
  'ME',
  'OH',
  'OK',
  'OR',
]);

/** County-type words at the end of a name: "Cobb County" also matches "Cobb". */
const COUNTY_SUFFIX = / (?:County|Parish|City and Borough|Borough|Census Area|Municipality|city)$/i;

function option(id: string, label: string, ...otherNames: string[]): StepOption {
  const keys = new Set([label, id, ...otherNames].map(matchKey).filter(Boolean));
  return { id, label, keys: [...keys] };
}

function categoryOption(key: CategoryKey): StepOption {
  return option(key, copy.categories[key], copy.categoriesPlural[key]);
}

function countyOption(county: County): StepOption {
  const base = county.name.replace(COUNTY_SUFFIX, '');
  return option(county.fips, county.name, base);
}

function buildStepSpec(geo: Geo, step: InterpretStep, context: StepContext): StepSpec {
  const steps = copy.steps;
  switch (step) {
    case 'welcome':
      return {
        step,
        question: steps.welcome.message,
        options: [
          option('divorce', steps.welcome.optionDivorce),
          option('professional', steps.welcome.optionProfessional),
        ],
      };
    case 'location':
      return {
        step,
        question: steps.location.message,
        options: [
          ...geo
            .states()
            .map((state) =>
              AMBIGUOUS_STATE_CODES.has(state.code)
                ? { id: state.code, label: state.name, keys: [matchKey(state.name)] }
                : option(state.code, state.name),
            ),
          option('uk', steps.location.optionUk),
          option('outside', steps.location.optionOutside),
        ],
      };
    case 'county': {
      const state = context.state ? geo.state(context.state) : undefined;
      return {
        step,
        question: fill(steps.county.message, { state: state?.name ?? context.state ?? '' }),
        options: [
          ...(state ? geo.counties(state.code).map(countyOption) : []),
          option('not_sure', steps.county.notSure),
        ],
      };
    }
    case 'stage':
      return {
        step,
        question: steps.stage.message,
        options: STAGE_KEYS.map((key) => option(key, steps.stage.options[key])),
      };
    case 'category':
      return {
        step,
        question: steps.category.message,
        options: [
          ...CATEGORY_KEYS.map(categoryOption),
          option('more', steps.category.more),
          option('not_sure', steps.category.notSure),
        ],
      };
    case 'category_more':
      return {
        step,
        question: steps.categoryMore.message,
        options: MORE_CATEGORIES.map(categoryOption),
      };
    case 'category_help':
      return { step, question: steps.category.message, options: CATEGORY_KEYS.map(categoryOption) };
    case 'subcategory': {
      const { category } = context;
      let subtypes: StepOption[] = [];
      if (category && hasSubtypes(category)) {
        const labels: Readonly<Record<string, string>> = copy.subtypes[category];
        const keys: readonly string[] = SUBTYPES[category];
        subtypes = keys.map((key) => option(key, labels[key] ?? key));
      }
      return {
        step,
        question: steps.subcategory.message,
        options: [...subtypes, option('any', steps.subcategory.any)],
      };
    }
    case 'other':
      return { step, question: null, options: [] };
  }
}

/**
 * Builds step specs, cached: the options only depend on the step, the state and the category,
 * which the router has validated (51 states, 4 categories with subtypes).
 */
export function createStepSpecs(
  geo: Geo,
): (step: InterpretStep, context?: StepContext) => StepSpec {
  const cache = new Map<string, StepSpec>();
  return (step, context = {}) => {
    const cacheKey = `${step}|${context.state ?? ''}|${context.category ?? ''}`;
    let spec = cache.get(cacheKey);
    if (!spec) {
      spec = buildStepSpec(geo, step, context);
      // Unknown states and categories never reach this point; the cap is a backstop.
      if (cache.size < 500) cache.set(cacheKey, spec);
    }
    return spec;
  };
}

/**
 * The option whose label, id or other name the text equals, ignoring case, accents, spaces and
 * punctuation. Null when nothing matches, or when the name fits several options (for example
 * "Baltimore": Baltimore County and Baltimore city), so the AI can ask instead.
 */
export function exactOption(text: string, options: readonly StepOption[]): string | null {
  const key = matchKey(text);
  if (!key) return null;
  let found: string | null = null;
  for (const candidate of options) {
    if (!candidate.keys.includes(key)) continue;
    if (found !== null && found !== candidate.id) return null;
    found = candidate.id;
  }
  return found;
}

/**
 * For the AI: what the visitor is looking at on the widget's steps that ask no question of their
 * own, so "What can you do for me?" at the end of the professional path gets a fitting reply.
 */
export function whereFor(
  at: StepId | undefined,
  { joinLink }: { joinLink: boolean } = { joinLink: true },
): string | null {
  const steps = copy.steps;
  const startOver = steps.whatsNext.startOver;
  switch (at) {
    case 'pro_info':
      // Only a button that is really there (JOIN_URL may not be set yet).
      return joinLink
        ? `The visitor said they are a divorce professional. The assistant welcomed them; the buttons are "${steps.proInfo.joinButton}" (the network's page about membership and joining) and "${startOver}". A professional looking for help with their own divorce can choose "${startOver}".`
        : `The visitor said they are a divorce professional. The assistant welcomed them and thanked them for their interest in joining; there is no button about joining, so for membership and joining, Tracy, the network's founder, can tell them. The only button is "${startOver}", for a professional looking for help with their own divorce.`;
    case 'uk':
      return `The visitor is in the UK. The assistant pointed them to the network's UK site (the "${steps.uk.button}" button); there is also "${startOver}".`;
    case 'outside':
      return `The visitor is outside the US and UK. The assistant offered "${steps.outside.emailTracy}": Tracy, the network's founder, may still be able to help.`;
    case 'results':
      return 'The assistant is showing the visitor the matching professionals as cards. They can select up to five and press "Contact selected" to send them one request; the professionals reply to them directly.';
    case 'no_match':
      return `Nobody in the network covers the visitor's county for that kind of professional. The buttons are "${steps.noMatch.emailTracy}" (Tracy, the founder, helps personally), "${steps.noMatch.tryAnother}" and "${steps.noMatch.startOver}".`;
    case 'done':
      return `The visitor's request was sent: the professionals (or Tracy) will reply to them directly. The buttons offer other kinds of professionals and "${startOver}".`;
    case 'county_confirm':
      return 'The assistant suggested which county the visitor lives in and asked whether that is right (buttons "Yes" and "No, let me pick").';
    default:
      return null;
  }
}
