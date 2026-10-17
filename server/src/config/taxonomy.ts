/**
 * The professional taxonomy (spec: "Taxonomy"). Keys and matching rules live here; every
 * visitor-facing label lives in copy.ts (spec rule 6).
 *
 * Plain data, no imports: the widget bundles this file too (as `@adn/taxonomy`).
 */

export const CATEGORY_KEYS = [
  'attorney',
  'mediator',
  'financial',
  'coach',
  'therapist',
  'real_estate',
  'arbitrator',
  'parenting_coordinator',
  'estate_attorney',
  'qdro_attorney',
  'bankruptcy_attorney',
  'paralegal',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** The category step's buttons, in the spec's order (then "More options" and "I'm not sure"). */
export const MAIN_CATEGORIES = [
  'attorney',
  'mediator',
  'financial',
  'coach',
  'therapist',
  'real_estate',
] as const satisfies readonly CategoryKey[];

/** The category_more step's buttons, in the spec's order. */
export const MORE_CATEGORIES = [
  'arbitrator',
  'parenting_coordinator',
  'estate_attorney',
  'qdro_attorney',
  'bankruptcy_attorney',
  'paralegal',
] as const satisfies readonly CategoryKey[];

/** Subtypes, for the four categories that have a subcategory step. */
export const SUBTYPES = {
  financial: ['cdfa', 'planner', 'forensic', 'valuation', 'accountant', 'insurance'],
  coach: ['divorce', 'transition', 'parenting', 'life', 'wellness', 'other'],
  therapist: ['adults', 'couples', 'coparenting', 'children', 'adolescents', 'other'],
  real_estate: ['agent', 'mortgage', 'appraiser', 'interior'],
} as const satisfies Partial<Record<CategoryKey, readonly string[]>>;

export type CategoryWithSubtypes = keyof typeof SUBTYPES;
export type SubtypeKey = (typeof SUBTYPES)[CategoryWithSubtypes][number];

/** The "Any / not sure" subtype: matches the whole category (the default). */
export const ANY_SUBTYPE = 'any';

export function hasSubtypes(category: CategoryKey): category is CategoryWithSubtypes {
  return Object.hasOwn(SUBTYPES, category);
}

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value);
}

/** True when `subtype` is a specific subtype of `category` (not "any"). */
export function isSubtypeOf(category: CategoryKey, subtype: unknown): subtype is SubtypeKey {
  if (!hasSubtypes(category) || typeof subtype !== 'string') return false;
  return (SUBTYPES[category] as readonly string[]).includes(subtype);
}

/**
 * Sheet labels ("Profession Type(s)" in the member list) and what they match.
 * subtype null = the parent label (for example "Financial"): it matches the category with
 * "Any" subtype, but not a specific subtype (spec: "A specific subtype needs that exact label").
 * The import compares labels ignoring case and the spaces around "-".
 */
export const SHEET_LABELS = {
  'Lawyer- Divorce and Family Law': { category: 'attorney', subtype: null },
  'ADR - Mediator': { category: 'mediator', subtype: null },
  Financial: { category: 'financial', subtype: null },
  'Financial - Certified Divorce Financial Analyst': { category: 'financial', subtype: 'cdfa' },
  'Financial - Planner/Advisor': { category: 'financial', subtype: 'planner' },
  'Financial - Forensic Accountant': { category: 'financial', subtype: 'forensic' },
  'Financial - Business Valuations': { category: 'financial', subtype: 'valuation' },
  'Financial - Accountant': { category: 'financial', subtype: 'accountant' },
  'Financial - Insurance': { category: 'financial', subtype: 'insurance' },
  Coaching: { category: 'coach', subtype: null },
  'Coaching - Divorce': { category: 'coach', subtype: 'divorce' },
  'Coaching - Divorce Transition': { category: 'coach', subtype: 'transition' },
  'Coaching - Parenting': { category: 'coach', subtype: 'parenting' },
  'Coaching - Life': { category: 'coach', subtype: 'life' },
  'Coaching - Wellness': { category: 'coach', subtype: 'wellness' },
  'Coaching - Other': { category: 'coach', subtype: 'other' },
  'Mental Health': { category: 'therapist', subtype: null },
  'Mental Health - Adults': { category: 'therapist', subtype: 'adults' },
  'Mental Health - Couples': { category: 'therapist', subtype: 'couples' },
  'Mental Health - Co-parenting': { category: 'therapist', subtype: 'coparenting' },
  'Mental Health - Children': { category: 'therapist', subtype: 'children' },
  'Mental Health - Adolescents': { category: 'therapist', subtype: 'adolescents' },
  'Mental Health - Other': { category: 'therapist', subtype: 'other' },
  'Real Estate': { category: 'real_estate', subtype: null },
  'Real Estate - Agent/Broker': { category: 'real_estate', subtype: 'agent' },
  'Real Estate - Mortgage Lender': { category: 'real_estate', subtype: 'mortgage' },
  'Real Estate - Appraiser': { category: 'real_estate', subtype: 'appraiser' },
  'Real Estate - Interior Design': { category: 'real_estate', subtype: 'interior' },
  'ADR - Arbitrator': { category: 'arbitrator', subtype: null },
  'ADR - Parent Coordinator': { category: 'parenting_coordinator', subtype: null },
  'Lawyer- Wills and Estate Planning': { category: 'estate_attorney', subtype: null },
  'Lawyer- QDRO/Retirement Division': { category: 'qdro_attorney', subtype: null },
  'Lawyer- Bankruptcy': { category: 'bankruptcy_attorney', subtype: null },
  Paralegal: { category: 'paralegal', subtype: null },
  'Paralegal - Paralegal Document Preparer': { category: 'paralegal', subtype: null },
} as const satisfies Record<string, { category: CategoryKey; subtype: string | null }>;

export type SheetLabel = keyof typeof SHEET_LABELS;

/**
 * "Financial - *", "Coaching - *", "Mental Health - *" and "Real Estate - *" labels that are not
 * listed above still belong to their category (with no subtype, and an import warning).
 */
export const PARENT_PREFIXES = {
  Financial: 'financial',
  Coaching: 'coach',
  'Mental Health': 'therapist',
  'Real Estate': 'real_estate',
  Paralegal: 'paralegal',
} as const satisfies Record<string, CategoryKey>;

/** Not a profession: the "Certified Amicable Divorce Professional" badge. */
export const CADP_LABEL = 'Certified Amicable Divorce Professional';
/** Not a profession: a business partner (flag "supporter"). */
export const SUPPORTER_LABEL = 'Amicable Divorce Supporter';
/** Umbrella labels that match nothing on their own. */
export const IGNORED_LABELS = ['Legal', '(ADR) Alternative Dispute Resolution'] as const;

/** Where the visitor is in the process (the stage step), in the spec's order. */
export const STAGE_KEYS = ['exploring', 'ready', 'in_process', 'post_divorce'] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export function isStageKey(value: unknown): value is StageKey {
  return typeof value === 'string' && (STAGE_KEYS as readonly string[]).includes(value);
}

/** "Find another type of professional" suggestions on the what's next screen. */
export const NEXT_SUGGESTIONS = {
  attorney: ['mediator', 'financial', 'therapist'],
  mediator: ['attorney', 'financial', 'coach'],
  financial: ['attorney', 'real_estate'],
  coach: ['therapist', 'mediator'],
  therapist: ['coach', 'mediator'],
  real_estate: ['financial', 'attorney'],
} as const satisfies Partial<Record<CategoryKey, readonly CategoryKey[]>>;

export function nextSuggestions(category: CategoryKey): readonly CategoryKey[] {
  return Object.hasOwn(NEXT_SUGGESTIONS, category)
    ? NEXT_SUGGESTIONS[category as keyof typeof NEXT_SUGGESTIONS]
    : [];
}

/** Membership tiers, best first. Platinum members always show first and are statewide. */
export const TIERS = ['platinum', 'gold', 'silver'] as const;
export type Tier = (typeof TIERS)[number];
