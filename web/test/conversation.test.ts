import { describe, expect, it } from 'vitest';
import {
  canGoBack,
  conversationReducer,
  initialConversation,
  type ConversationAction,
  type ConversationState,
} from '../src/flow/conversation';
import type { StepOption } from '../src/flow/steps';

const divorce: StepOption = { id: 'divorce', label: 'Going through a divorce', next: 'location' };
const professional: StepOption = { id: 'professional', label: 'A professional', next: 'pro_info' };

function run(...actions: ConversationAction[]): ConversationState {
  return actions.reduce(conversationReducer, initialConversation());
}

const steps = (state: ConversationState) => state.turns.map((turn) => turn.step);

describe('conversation', () => {
  it('starts by typing the welcome step', () => {
    const state = initialConversation();
    expect(state.turns).toEqual([]);
    expect(state.pending).toEqual({ kind: 'step', step: 'welcome' });
    expect(state.focus).toBeNull(); // never takes focus on page load
    expect(steps(run({ type: 'reveal' }))).toEqual(['welcome']);
  });

  it('records an answer, then shows the next step', () => {
    const answered = run({ type: 'reveal' }, { type: 'choose', option: divorce });
    expect(answered.turns[0]?.answer).toEqual({ optionId: 'divorce', label: divorce.label });
    expect(answered.pending).toEqual({ kind: 'step', step: 'location' });
    expect(answered.focus?.target).toBe('input');

    const next = conversationReducer(answered, { type: 'reveal' });
    expect(steps(next)).toEqual(['welcome', 'location']);
    expect(next.pending).toBeNull();
  });

  it('ignores a second answer while the bot is typing or after answering', () => {
    const answered = run({ type: 'reveal' }, { type: 'choose', option: divorce });
    expect(conversationReducer(answered, { type: 'choose', option: professional })).toBe(answered);
  });

  it('goes back to the previous step and clears its answer', () => {
    const state = run(
      { type: 'reveal' },
      { type: 'choose', option: divorce },
      { type: 'reveal' },
      { type: 'back' },
    );
    expect(steps(state)).toEqual(['welcome']);
    expect(state.turns[0]?.answer).toBeUndefined();
    expect(state.pending).toBeNull();
  });

  it('can change an answer after going back (later answers are gone)', () => {
    const state = run(
      { type: 'reveal' },
      { type: 'choose', option: divorce },
      { type: 'reveal' },
      { type: 'back' },
      { type: 'choose', option: professional },
      { type: 'reveal' },
    );
    expect(steps(state)).toEqual(['welcome', 'pro_info']);
    expect(state.turns[0]?.answer?.optionId).toBe('professional');
  });

  it('undoes an answer whose next step has not appeared yet', () => {
    const state = run({ type: 'reveal' }, { type: 'choose', option: divorce }, { type: 'back' });
    expect(steps(state)).toEqual(['welcome']);
    expect(state.turns[0]?.answer).toBeUndefined();
    expect(state.pending).toBeNull();
  });

  it('only allows Back once there is something to undo', () => {
    expect(canGoBack(initialConversation())).toBe(false);
    expect(canGoBack(run({ type: 'reveal' }))).toBe(false);
    expect(canGoBack(run({ type: 'reveal' }, { type: 'choose', option: divorce }))).toBe(true);
    expect(canGoBack(run({ type: 'reveal' }, { type: 'say', text: 'hello' }))).toBe(true);
    const pristine = run({ type: 'reveal' });
    expect(conversationReducer(pristine, { type: 'back' })).toBe(pristine);
  });

  it('keeps typed text and the reply with the step', () => {
    const typing = run({ type: 'reveal' }, { type: 'say', text: '  I need help  ' });
    expect(typing.turns[0]?.asides.map((aside) => aside.text)).toEqual(['I need help']);
    expect(typing.turns[0]?.asides[0]?.reply).toBeUndefined();
    expect(typing.pending).toMatchObject({ kind: 'reply' });
    expect(typing.focus?.target).toBe('composer');

    const replied = conversationReducer(typing, { type: 'reply', text: 'Sorry…' });
    expect(replied.turns[0]?.asides[0]?.reply).toBe('Sorry…');
    expect(replied.pending).toBeNull();
  });

  it('ignores empty text and text sent while the bot is typing', () => {
    const ready = run({ type: 'reveal' });
    expect(conversationReducer(ready, { type: 'say', text: '   ' })).toBe(ready);
    const typing = conversationReducer(ready, { type: 'say', text: 'one' });
    expect(conversationReducer(typing, { type: 'say', text: 'two' })).toBe(typing);
  });

  it('clears typed text when going back to the first step', () => {
    const state = run(
      { type: 'reveal' },
      { type: 'say', text: 'hello' },
      { type: 'reply', text: 'Sorry…' },
      { type: 'back' },
    );
    expect(state.turns[0]?.asides).toEqual([]);
  });

  it('starts over from the welcome step', () => {
    const state = run(
      { type: 'reveal' },
      { type: 'choose', option: divorce },
      { type: 'reveal' },
      { type: 'restart' },
    );
    expect(state.turns).toEqual([]);
    expect(state.pending).toEqual({ kind: 'step', step: 'welcome' });
    expect(state.focus?.target).toBe('input');
  });

  it('makes each focus request unique', () => {
    const first = run({ type: 'reveal' }, { type: 'choose', option: divorce });
    const second = conversationReducer(first, { type: 'back' });
    expect(second.focus?.seq).toBeGreaterThan(first.focus?.seq ?? 0);
  });
});
