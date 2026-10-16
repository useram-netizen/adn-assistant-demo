import type { StepId, StepOption } from './steps';

/**
 * The conversation, kept in memory only (spec rule 4).
 *
 * It is a list of turns, one per step. The last turn is the current step. Each turn holds
 * the visitor's answer (once given) and any "asides": text the visitor typed at that step,
 * with the bot's reply. The transcript on screen is drawn from this list, so going back
 * simply drops the later turns, which clears every answer after the step being changed.
 */
export interface Answer {
  optionId: string;
  label: string;
}

export interface Aside {
  id: number;
  text: string;
  reply?: string;
}

export interface Turn {
  id: number;
  step: StepId;
  answer?: Answer;
  asides: Aside[];
}

/** What the bot is "typing": the next step, or a reply to typed text. */
export type Pending = { kind: 'step'; step: StepId } | { kind: 'reply'; asideId: number } | null;

/** Where focus should go once the bot has finished typing. `seq` makes each request unique. */
export interface FocusRequest {
  target: 'input' | 'composer';
  seq: number;
}

export interface ConversationState {
  turns: Turn[];
  pending: Pending;
  nextId: number;
  /** Null until the visitor does something, so the widget never takes focus on page load. */
  focus: FocusRequest | null;
}

export type ConversationAction =
  | { type: 'choose'; option: StepOption }
  | { type: 'say'; text: string }
  | { type: 'reveal' }
  | { type: 'reply'; text: string }
  | { type: 'back' }
  | { type: 'restart' };

export function initialConversation(): ConversationState {
  return { turns: [], pending: { kind: 'step', step: 'welcome' }, nextId: 1, focus: null };
}

function requestFocus(state: ConversationState, target: FocusRequest['target']): FocusRequest {
  return { target, seq: (state.focus?.seq ?? 0) + 1 };
}

/** A step shown again from the start: no answer and no asides. */
function reopen(turn: Turn): Turn {
  return { id: turn.id, step: turn.step, asides: [] };
}

function replaceLast(turns: Turn[], turn: Turn): Turn[] {
  return [...turns.slice(0, -1), turn];
}

/** True when Back (and Start over) would change something. */
export function canGoBack(state: ConversationState): boolean {
  const [first] = state.turns;
  if (!first) return false;
  return state.turns.length > 1 || first.answer !== undefined || first.asides.length > 0;
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  const current = state.turns.at(-1);

  switch (action.type) {
    case 'choose': {
      if (state.pending || !current || current.answer) return state;
      const answer = { optionId: action.option.id, label: action.option.label };
      return {
        ...state,
        turns: replaceLast(state.turns, { ...current, answer }),
        pending: { kind: 'step', step: action.option.next },
        focus: requestFocus(state, 'input'),
      };
    }

    case 'say': {
      const text = action.text.trim();
      if (state.pending || !current || current.answer || !text) return state;
      const aside = { id: state.nextId, text };
      return {
        ...state,
        turns: replaceLast(state.turns, { ...current, asides: [...current.asides, aside] }),
        nextId: state.nextId + 1,
        pending: { kind: 'reply', asideId: aside.id },
        focus: requestFocus(state, 'composer'),
      };
    }

    case 'reveal': {
      if (state.pending?.kind !== 'step') return state;
      const turn: Turn = { id: state.nextId, step: state.pending.step, asides: [] };
      return { ...state, turns: [...state.turns, turn], nextId: state.nextId + 1, pending: null };
    }

    case 'reply': {
      const pending = state.pending;
      if (pending?.kind !== 'reply' || !current) return state;
      const asides = current.asides.map((aside) =>
        aside.id === pending.asideId ? { ...aside, reply: action.text } : aside,
      );
      return { ...state, turns: replaceLast(state.turns, { ...current, asides }), pending: null };
    }

    case 'back': {
      if (!current || !canGoBack(state)) return state;
      let turns: Turn[];
      if (state.pending?.kind === 'step' || state.turns.length === 1) {
        // The current step was just answered (or is the first step): show it again.
        turns = replaceLast(state.turns, reopen(current));
      } else {
        // Drop the current step and reopen the one before it, clearing its answer.
        const earlier = state.turns.slice(0, -1);
        const previous = earlier.at(-1);
        turns = previous ? replaceLast(earlier, reopen(previous)) : earlier;
      }
      return { ...state, turns, pending: null, focus: requestFocus(state, 'input') };
    }

    case 'restart':
      return {
        turns: [],
        pending: { kind: 'step', step: 'welcome' },
        nextId: state.nextId,
        focus: requestFocus(state, 'input'),
      };
  }
}
