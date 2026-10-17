import type {
  CountyOption,
  ProfessionalCard,
  RecommendResponse,
  SituationResponse,
  StateOption,
  StepId,
} from '@adn/api';
import type { CategoryKey, StageKey } from '@adn/taxonomy';

export type { StepId };

/** One line of the transcript. The safety card has no text of its own (it is static wording). */
export interface Item {
  id: number;
  kind: 'bot' | 'visitor' | 'safety';
  text: string;
}

/** What the visitor has answered so far. All values come from validated options (rule 3). */
export interface Answers {
  /** USPS code. */
  state: string | null;
  stateName: string | null;
  countyFips: string | null;
  countyName: string | null;
  stage: StageKey | null;
  category: CategoryKey | null;
  /** "any" (the whole category) or a subtype of the category. */
  subcategory: string;
  tracyReason: 'no_match' | 'outside' | null;
}

export interface ResultsState {
  cards: ProfessionalCard[];
  counts: { platinum: number; gold: number; silver: number };
  /** How many cards are showing (6 at a time). */
  shown: number;
  /** Member ids, in the order they were picked (at most 5). */
  selected: string[];
}

export type Recommendation = RecommendResponse['recommendations'][number];

export interface ContactValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredContact: 'email' | 'phone';
  message: string;
  consent: boolean;
  /** The hidden honeypot field: people leave it empty. */
  trap: string;
}

export interface FormState {
  kind: 'pros' | 'tracy';
  values: ContactValues;
  submitting: boolean;
  /** A friendly message for a failed submit (shown with a way to try again). */
  error: string | null;
  /** The fields the server did not accept (shown next to those fields). */
  serverFields?: readonly string[];
}

export interface DoneState {
  kind: 'pros' | 'tracy';
  /** The professionals' names (empty for Tracy). */
  names: string[];
  /** The message looked like a safety concern: show the safety card if it wasn't shown yet. */
  safety: boolean;
}

/** "Did you mean {label}?": typed text that matched an option, waiting for Yes or No. */
export interface Confirm {
  step: StepId;
  optionId: string;
  label: string;
}

/** What Back needs to show a step again, exactly as it was. */
export interface Snapshot {
  step: StepId;
  answers: Answers;
  /** How many transcript lines were showing when the step was waiting for an answer. */
  itemsLen: number;
  texts: string[];
  analysis: SituationResponse | null;
  results: ResultsState | null;
  recommendations: Recommendation[] | null;
  countyCandidate: CountyOption | null;
  form: FormState | null;
}

export interface ChatState {
  started: boolean;
  items: Item[];
  /** The step waiting for an answer; null while the assistant is busy or after a failure. */
  step: StepId | null;
  /** Counts the steps shown: when it changes, focus moves to the new input. */
  stepSeq: number;
  /**
   * Where focus goes when the next step appears: the new input after a click, the text box
   * after typing, and nowhere on first load (the widget never takes focus by itself).
   */
  focus: 'input' | 'composer' | 'none';
  /** The assistant is typing or waiting for the server: no input is shown. */
  busy: boolean;
  answers: Answers;
  history: Snapshot[];
  /** The step as it was when it started waiting (what Back returns to). */
  entry: { itemsLen: number; texts: string[]; analysis: SituationResponse | null } | null;
  /** The safety card is shown once per session. */
  safetyShown: boolean;
  /** Everything the visitor said about their situation, from any step. */
  texts: string[];
  analysis: SituationResponse | null;
  lists: {
    states: StateOption[];
    counties: CountyOption[];
    /** The state `counties` belongs to. */
    countiesFor: string | null;
  };
  countyCandidate: CountyOption | null;
  /** The AI's recommendations on the category help step; null shows the static list. */
  recommendations: Recommendation[] | null;
  confirm: Confirm | null;
  results: ResultsState | null;
  form: FormState | null;
  done: DoneState | null;
  /** After a failure: repeats what failed. The widget shows a "Try again" button. */
  retry: (() => void) | null;
}

export const SHOW_MORE_STEP = 6;
export const MAX_SELECTED = 5;
