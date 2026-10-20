import { copy } from '@adn/copy';
import {
  CATEGORY_KEYS,
  MAIN_CATEGORIES,
  MORE_CATEGORIES,
  STAGE_KEYS,
  SUBTYPES,
  hasSubtypes,
  isCategoryKey,
  nextSuggestions,
  type CategoryKey,
} from '@adn/taxonomy';
import type { Answers, ChatState } from './types';

/** A button of a step. `id` is the value the step receives (never shown to the visitor). */
export interface OptionItem {
  id: string;
  label: string;
  /** A second, quieter line (a reason or an explanation). */
  description?: string;
  /** A small tag, such as "Suggested". */
  tag?: string;
}

type OptionContext = Pick<
  ChatState,
  'answers' | 'analysis' | 'recommendations' | 'countyCandidate' | 'lists'
>;

function categoryOption(key: CategoryKey, suggested: readonly CategoryKey[]): OptionItem {
  return {
    id: key,
    label: copy.categories[key],
    ...(suggested.includes(key) ? { tag: copy.steps.category.suggested } : {}),
  };
}

/** The category step's buttons: the six main kinds, then "More options" and "I'm not sure". */
export function categoryOptions(suggested: readonly CategoryKey[]): OptionItem[] {
  return [
    ...MAIN_CATEGORIES.map((key) => categoryOption(key, suggested)),
    { id: 'more', label: copy.steps.category.more },
    { id: 'not_sure', label: copy.steps.category.notSure },
  ];
}

export function subtypeOptions(category: CategoryKey | null): OptionItem[] {
  if (!category || !hasSubtypes(category)) return [];
  const labels: Readonly<Record<string, string>> = copy.subtypes[category];
  const subtypes: readonly string[] = SUBTYPES[category];
  return [
    ...subtypes.map((id) => ({ id, label: labels[id] ?? id })),
    { id: 'any', label: copy.steps.subcategory.any },
  ];
}

/** The "find another type" suggestions on the last screen. */
export function suggestionOptions(category: CategoryKey | null): OptionItem[] {
  if (!category) return [];
  return nextSuggestions(category).map((key) => ({ id: key, label: copy.categories[key] }));
}

/** The buttons of a step (the state and county dropdowns, cards and forms are separate). */
export function stepOptions(step: string, context: OptionContext): OptionItem[] {
  const suggested = context.analysis?.suggestedCategories ?? [];
  switch (step) {
    case 'welcome':
      return [
        { id: 'divorce', label: copy.steps.welcome.optionDivorce },
        { id: 'professional', label: copy.steps.welcome.optionProfessional },
      ];
    case 'location':
      return [
        { id: 'uk', label: copy.steps.location.optionUk },
        { id: 'outside', label: copy.steps.location.optionOutside },
      ];
    case 'outside':
      return [{ id: 'tracy', label: copy.steps.outside.emailTracy }];
    // The ends of the professional and UK paths: never without a way on.
    case 'pro_info':
    case 'uk':
      return [{ id: 'restart', label: copy.steps.whatsNext.startOver }];
    case 'county':
      return [{ id: 'not_sure', label: copy.steps.county.notSure }];
    case 'county_confirm':
      return [
        { id: 'yes', label: copy.steps.countyHelp.yes },
        { id: 'no', label: copy.steps.countyHelp.noPick },
      ];
    case 'stage':
      return STAGE_KEYS.map((id) => ({ id, label: copy.steps.stage.options[id] }));
    case 'situation':
      return [{ id: 'skip', label: copy.steps.situation.skip }];
    case 'category':
      return categoryOptions(suggested);
    case 'category_more':
      return MORE_CATEGORIES.map((key) => categoryOption(key, suggested));
    case 'category_help':
      if (context.recommendations) {
        return [
          ...context.recommendations.map(({ category, reason }) => ({
            id: category,
            label: copy.categories[category],
            description: reason,
          })),
          { id: 'see_all', label: copy.steps.categoryHelp.seeAll },
        ];
      }
      return CATEGORY_KEYS.map((key) => ({
        id: key,
        label: copy.categories[key],
        description: copy.categoryExplanations[key],
      }));
    case 'subcategory':
      return subtypeOptions(context.answers.category);
    case 'no_match':
      return [
        { id: 'tracy', label: copy.steps.noMatch.emailTracy },
        { id: 'another', label: copy.steps.noMatch.tryAnother },
        { id: 'restart', label: copy.steps.noMatch.startOver },
      ];
    case 'done':
      return [
        ...suggestionOptions(context.answers.category),
        ...(context.answers.category && suggestionOptions(context.answers.category).length === 0
          ? [{ id: 'another', label: copy.steps.whatsNext.anotherType }]
          : []),
        { id: 'restart', label: copy.steps.whatsNext.startOver },
      ];
    default:
      return [];
  }
}

/** The visitor-facing label of an option, for echoing it as their message. Null if unknown. */
export function optionLabel(
  step: string,
  id: string,
  context: OptionContext & { answers: Answers },
): string | null {
  if (step === 'location' && id !== 'uk' && id !== 'outside') {
    return context.lists.states.find((state) => state.code === id)?.name ?? null;
  }
  if (step === 'county' && id !== 'not_sure') {
    return context.lists.counties.find((county) => county.fips === id)?.name ?? null;
  }
  // The AI is offered every kind of professional on these steps, whichever buttons show.
  if (
    (step === 'category' || step === 'category_more' || step === 'category_help') &&
    isCategoryKey(id)
  ) {
    return copy.categories[id];
  }
  return stepOptions(step, context).find((option) => option.id === id)?.label ?? null;
}

/** The text says it is a county ("Cobb County"), not a city that happens to share the name. */
export function namesACounty(text: string): boolean {
  return /\b(county|parish|borough|census area)\b/i.test(text);
}
