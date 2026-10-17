import type { InterpretResponse, InterpretStep, SituationResponse } from '@adn/api';
import { copy, fill } from '@adn/copy';
import { hasSubtypes, isCategoryKey, isStageKey, type CategoryKey } from '@adn/taxonomy';
import { ApiError, type Api, type PublicConfig } from '../lib/api';
import type { EmbedMode } from '../lib/embedContext';
import type { Tracker } from '../lib/events';
import { emptyContact, joinNames, prefillMessage } from './form';
import { optionLabel } from './options';
import {
  MAX_SELECTED,
  SHOW_MORE_STEP,
  type Answers,
  type ChatState,
  type ContactValues,
  type Item,
  type Snapshot,
  type StepId,
} from './types';

export interface ChatDeps {
  api: Api;
  config: PublicConfig;
  sessionId: string;
  site: string;
  mode: EmbedMode;
  tracker: Tracker;
  /** How long the typing indicator shows before each bot message (0 in tests). */
  typingDelayMs: number;
}

interface ShowOptions {
  /** Say these instead of the step's usual question. */
  messages?: string[];
}

const emptyAnswers = (): Answers => ({
  state: null,
  stateName: null,
  countyFips: null,
  countyName: null,
  stage: null,
  category: null,
  subcategory: 'any',
  tracyReason: null,
});

function initialState(safetyShown = false, lists?: ChatState['lists']): ChatState {
  return {
    started: false,
    items: [],
    step: null,
    stepSeq: 0,
    focus: 'input',
    busy: false,
    answers: emptyAnswers(),
    history: [],
    entry: null,
    safetyShown,
    texts: [],
    analysis: null,
    lists: lists ?? { states: [], counties: [], countiesFor: null },
    countyCandidate: null,
    recommendations: null,
    confirm: null,
    results: null,
    form: null,
    done: null,
    retry: null,
  };
}

/** The step names the server understands for typed text; every other step is "other". */
const INTERPRET_STEPS: Partial<Record<StepId, InterpretStep>> = {
  welcome: 'welcome',
  location: 'location',
  county: 'county',
  stage: 'stage',
  category: 'category',
  category_more: 'category_more',
  category_help: 'category_help',
  subcategory: 'subcategory',
};

/** Typed answers accepted straight away (spec: at welcome and stage). */
const ACCEPT_DIRECTLY = new Set<StepId>(['welcome', 'stage']);
/** Options that are never asked about with "Did you mean…?". */
const NO_CONFIRM = new Set(['not_sure', 'more', 'any', 'see_all']);

/** The messages that do not need the AI (the server's fallback, and the AI being down). */
const UNCLEAR: InterpretResponse = {
  kind: 'unclear',
  optionId: null,
  reply: '',
  safety: false,
  sharesSituation: false,
  source: 'fallback',
};

function fallbackAnalysis(text: string): SituationResponse {
  return {
    reply: copy.steps.situation.ack,
    suggestedCategories: [],
    summary: text,
    safety: false,
    source: 'fallback',
  };
}

const TEXTS_LIMIT = 6;

/**
 * The whole conversation, without any React: what the assistant says at each step, how typed
 * text is handled, where Back goes. The widget shows `getState()` and calls the visitor
 * actions below. Everything is kept in memory (rule 4).
 *
 * Work that takes time (typing pauses, server calls) runs under an "epoch": Back, Start over
 * and failures start a new epoch, so a late answer from the server can never land on a screen
 * the visitor has already left.
 */
export class ChatController {
  private state: ChatState = initialState();
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  /** How many runs are still going in the latest epoch (see `run`). */
  private runs = { epoch: -1, count: 0 };
  private nextId = 1;
  /** The contact form as typed so far; kept outside the state so typing doesn't re-render. */
  private draft: ContactValues | null = null;
  /** Where focus goes when the next step appears (see ChatState.focus). */
  private nextFocus: ChatState['focus'] = 'none';

  constructor(private readonly deps: ChatDeps) {}

  // ---------------------------------------------------------------- Reading

  getState = (): ChatState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Back and Start over have something to undo. */
  get canGoBack(): boolean {
    return this.state.history.length > 0 || this.state.items.length > 1;
  }

  // ---------------------------------------------------------------- Visitor actions

  /** Shows the welcome message. Safe to call more than once. */
  start(): void {
    if (this.state.started) return;
    this.set({ started: true });
    this.deps.tracker.track('session_started', { mode: this.deps.mode });
    void this.run((epoch) => this.show('welcome', epoch));
  }

  /** A button, a state or county from a dropdown, or a card action at the current step. */
  choose(optionId: string): void {
    const { step, busy } = this.state;
    if (busy || !step) return;
    const label = optionLabel(step, optionId, this.state);
    if (label === null) return;
    this.nextFocus = 'input';
    this.add('visitor', label);
    this.applyChoice(step, optionId, label);
  }

  /** "Did you mean…?": Yes accepts the option, No shows the step's options again. */
  confirmAnswer(yes: boolean): void {
    const { confirm, busy } = this.state;
    if (busy || !confirm) return;
    this.nextFocus = 'input';
    this.add('visitor', yes ? copy.fallback.yes : copy.fallback.no);
    this.set({ confirm: null });
    if (yes) this.applyChoice(confirm.step, confirm.optionId, confirm.label);
    else
      void this.run((epoch) =>
        this.botSays([copy.fallback.pickInstead], epoch).then(() => undefined),
      );
  }

  /** What the visitor typed in the text box. */
  say(raw: string): void {
    const text = raw.trim().slice(0, 1000);
    const { step, busy } = this.state;
    if (!text || busy || !step || step === 'contact' || step === 'tracy') return;
    this.nextFocus = 'composer';
    this.set({ confirm: null });
    this.add('visitor', text);
    if (step === 'county_help') void this.run((epoch) => this.countyHelp(text, epoch));
    else if (step === 'situation') void this.run((epoch) => this.situation(text, epoch));
    else void this.run((epoch) => this.interpret(step, text, epoch));
  }

  /** "See all kinds of professionals" on the category help step. */
  seeAllCategories(): void {
    if (this.state.busy || this.state.step !== 'category_help') return;
    this.add('visitor', copy.steps.categoryHelp.seeAll);
    this.set({ recommendations: null });
    void this.run((epoch) =>
      this.botSays([copy.steps.categoryHelp.explain], epoch).then(() => undefined),
    );
  }

  showMore(): void {
    const { results } = this.state;
    if (!results) return;
    this.set({ results: { ...results, shown: results.shown + SHOW_MORE_STEP } });
  }

  /** Selects or unselects a professional (at most 5). */
  toggleSelected(id: string): void {
    const { results } = this.state;
    if (!results || !results.cards.some((card) => card.id === id)) return;
    const selected = results.selected.includes(id)
      ? results.selected.filter((other) => other !== id)
      : results.selected.length < MAX_SELECTED
        ? [...results.selected, id]
        : results.selected;
    this.set({ results: { ...results, selected } });
  }

  /** "Contact selected (n)". */
  contactSelected(): void {
    const { results, busy, step } = this.state;
    if (busy || step !== 'results' || !results || results.selected.length === 0) return;
    const count = results.selected.length;
    this.nextFocus = 'input';
    this.add('visitor', fill(copy.steps.results.contact, { n: count }));
    this.deps.tracker.track('pros_selected', { count });
    this.go('contact');
  }

  /** The form's values as typed, kept so that Back and forward again don't lose them. */
  saveDraft(values: ContactValues): void {
    this.draft = values;
  }

  /** Sends the contact form (to the selected professionals, or to Tracy). */
  submitForm(values: ContactValues): void {
    const { form, busy } = this.state;
    if (!form || form.submitting || busy) return;
    this.draft = values;
    this.set({ form: { ...form, values, submitting: true, error: null } });
    void this.sendForm(form.kind, values, this.epoch);
  }

  back(): void {
    const { history } = this.state;
    const snapshot = history.at(-1);
    if (!snapshot) {
      if (this.canGoBack) this.restart();
      return;
    }
    this.epoch += 1;
    this.draft = null;
    this.nextFocus = 'input';
    const s = this.state;
    const kept = s.items.slice(0, snapshot.itemsLen);
    // A safety card the visitor has seen stays on screen, wherever Back goes.
    const safety = s.items.slice(snapshot.itemsLen).filter((item) => item.kind === 'safety');
    const items = [...kept, ...safety];
    this.set({
      items,
      history: history.slice(0, -1),
      step: snapshot.step,
      answers: snapshot.answers,
      texts: snapshot.texts,
      analysis: snapshot.analysis,
      results: snapshot.results,
      recommendations: snapshot.recommendations,
      countyCandidate: snapshot.countyCandidate,
      form: snapshot.form ? { ...snapshot.form, submitting: false, error: null } : null,
      done: null,
      confirm: null,
      retry: null,
      busy: false,
      entry: { itemsLen: items.length, texts: snapshot.texts, analysis: snapshot.analysis },
      stepSeq: s.stepSeq + 1,
      focus: 'input',
    });
    // The county list belongs to the state; reload it if the visitor changed the state since.
    if (snapshot.step === 'county' && s.lists.countiesFor !== snapshot.answers.state) {
      const state = snapshot.answers.state;
      if (state) void this.ensureCounties(state).catch(() => undefined);
    }
  }

  /** Clears everything except the session and whether the safety card was shown. */
  restart(): void {
    this.epoch += 1;
    this.draft = null;
    this.nextFocus = 'input';
    const { safetyShown, lists, started, stepSeq } = this.state;
    this.state = { ...initialState(safetyShown, lists), started, stepSeq };
    this.emit();
    void this.run((epoch) => this.show('welcome', epoch));
  }

  /** The "Try again" button after a failure. */
  retryLast(): void {
    const { retry } = this.state;
    if (!retry) return;
    this.set({ retry: null });
    retry();
  }

  trackLink(
    link: 'join' | 'uk_site' | 'articles' | 'podcast' | 'booking' | 'privacy' | 'safety',
  ): void {
    this.deps.tracker.track('link_clicked', { link });
  }

  // ---------------------------------------------------------------- Choices

  /** Moves on after an answer. The visitor's own message has already been shown. */
  private applyChoice(step: StepId, id: string, label: string): void {
    this.deps.tracker.track('answer', { step, value: id });
    const { countyCandidate } = this.state;
    switch (step) {
      case 'welcome':
        this.go(id === 'professional' ? 'pro_info' : 'location');
        break;
      case 'location':
        if (id === 'uk') this.go('uk');
        else if (id === 'outside') this.go('outside');
        else {
          this.go('county', { state: id, stateName: label, countyFips: null, countyName: null });
        }
        break;
      case 'county':
        if (id === 'not_sure') this.go('county_help');
        else this.go('stage', { countyFips: id, countyName: label });
        break;
      case 'county_confirm':
        if (id === 'yes' && countyCandidate) {
          this.go('stage', { countyFips: countyCandidate.fips, countyName: countyCandidate.name });
        } else {
          this.go('county', {}, { messages: [copy.steps.countyHelp.pick] });
        }
        break;
      case 'stage':
        if (isStageKey(id)) this.go('situation', { stage: id });
        break;
      case 'situation':
        this.go('category');
        break;
      case 'category':
      case 'category_more':
      case 'category_help':
        if (id === 'more') this.go('category_more');
        else if (id === 'not_sure') this.go('category_help');
        else if (id === 'see_all') {
          this.set({ recommendations: null });
          void this.run((epoch) =>
            this.botSays([copy.steps.categoryHelp.explain], epoch).then(() => undefined),
          );
        } else if (isCategoryKey(id)) this.chooseCategory(id);
        break;
      case 'subcategory':
        this.go('results', { subcategory: id });
        break;
      case 'outside':
        this.go('tracy', { tracyReason: 'outside' });
        break;
      case 'no_match':
        if (id === 'tracy') this.go('tracy', { tracyReason: 'no_match' });
        else if (id === 'another') this.go('category');
        else this.restart();
        break;
      case 'done':
        if (id === 'restart') this.restart();
        else if (id === 'another') this.go('category');
        else if (isCategoryKey(id)) this.go('results', { category: id, subcategory: 'any' });
        break;
      default:
        break;
    }
  }

  private chooseCategory(category: CategoryKey): void {
    this.go(hasSubtypes(category) ? 'subcategory' : 'results', { category, subcategory: 'any' });
  }

  // ---------------------------------------------------------------- Typed text

  private async interpret(step: StepId, text: string, epoch: number): Promise<void> {
    const { answers } = this.state;
    const apiStep = INTERPRET_STEPS[step] ?? 'other';
    let result: InterpretResponse;
    try {
      result = await this.deps.api.interpret({
        sessionId: this.deps.sessionId,
        site: this.deps.site,
        step: apiStep,
        text,
        ...(apiStep === 'county' && answers.state ? { state: answers.state } : {}),
        ...(apiStep === 'subcategory' && answers.category ? { category: answers.category } : {}),
      });
    } catch {
      // The AI is down or slow: buttons only.
      result = UNCLEAR;
    }
    if (epoch !== this.epoch) return;

    if (result.safety) this.showSafety(result.source === 'ai' ? 'ai' : 'keyword');
    if (result.sharesSituation) this.addSituationText(text);

    if (result.kind === 'option' && result.optionId) {
      const label = optionLabel(step, result.optionId, this.state);
      if (label !== null) {
        if (result.reply && !(await this.botSays([result.reply], epoch))) return;
        const direct = ACCEPT_DIRECTLY.has(step) || result.source === 'exact';
        if (direct || NO_CONFIRM.has(result.optionId)) {
          this.applyChoice(step, result.optionId, label);
          return;
        }
        const ask = fill(copy.fallback.didYouMean, {
          label: this.confirmLabel(step, result.optionId, label),
        });
        if (!(await this.botSays([ask], epoch))) return;
        this.set({ confirm: { step, optionId: result.optionId, label } });
        return;
      }
    } else if (result.kind === 'question' && result.reply) {
      if (!(await this.botSays([result.reply, ...this.questionFor(step)], epoch))) return;
      await this.refreshAnalysisAfterSharing(step, epoch);
      return;
    }

    const hasInput = step !== 'pro_info' && step !== 'uk';
    const unclear = hasInput ? copy.fallback.didNotCatch : copy.fallback.didNotCatchNoOptions;
    if (!(await this.botSays([unclear], epoch))) return;
    await this.refreshAnalysisAfterSharing(step, epoch);
  }

  /** How "Did you mean…?" names an option (the two buttons at the state step read better as phrases). */
  private confirmLabel(step: StepId, id: string, label: string): string {
    if (step === 'location' && id === 'uk') return copy.steps.location.confirmUk;
    if (step === 'location' && id === 'outside') return copy.steps.location.confirmOutside;
    return label;
  }

  /** Text that shared the situation after the situation step updates the "Suggested" tags. */
  private async refreshAnalysisAfterSharing(step: StepId, epoch: number): Promise<void> {
    const afterSituation: StepId[] = ['category', 'category_more', 'category_help', 'subcategory'];
    if (afterSituation.includes(step)) await this.ensureAnalysis(epoch);
  }

  private async countyHelp(text: string, epoch: number): Promise<void> {
    const { answers } = this.state;
    if (!answers.state) return;
    let result;
    try {
      result = await this.deps.api.county({
        sessionId: this.deps.sessionId,
        site: this.deps.site,
        state: answers.state,
        text,
      });
    } catch {
      result = null;
    }
    if (epoch !== this.epoch) return;
    if (result?.safety) this.showSafety('ai');

    if (result?.countyFips && result.countyName) {
      this.set({ countyCandidate: { fips: result.countyFips, name: result.countyName } });
      this.go('county_confirm');
      return;
    }
    // Not found, or the AI is down: the county list.
    this.go('county', {}, { messages: [copy.steps.countyHelp.notFound] });
  }

  private async situation(text: string, epoch: number): Promise<void> {
    this.addSituationText(text);
    const { answers, texts } = this.state;
    const joined = texts.join(' ').slice(0, 1000);
    let analysis: SituationResponse;
    try {
      analysis = await this.deps.api.situation({
        sessionId: this.deps.sessionId,
        site: this.deps.site,
        stage: answers.stage,
        text: joined,
      });
    } catch {
      analysis = fallbackAnalysis(joined);
    }
    if (epoch !== this.epoch) return;
    if (analysis.safety) this.showSafety('ai');
    this.set({ analysis });
    if (!(await this.botSays([analysis.reply || copy.steps.situation.ack], epoch))) return;
    this.go('category');
  }

  private addSituationText(text: string): void {
    this.set((s) => ({ texts: [...s.texts, text].slice(-TEXTS_LIMIT), analysis: null }));
  }

  /** Asks the AI about the situation the visitor described, unless it is already known. */
  private async ensureAnalysis(epoch: number): Promise<void> {
    const { analysis, texts, answers } = this.state;
    if (analysis || texts.length === 0) return;
    const text = texts.join(' ').slice(0, 1000);
    let result: SituationResponse;
    try {
      result = await this.deps.api.situation({
        sessionId: this.deps.sessionId,
        site: this.deps.site,
        stage: answers.stage,
        text,
      });
    } catch {
      result = fallbackAnalysis(text);
    }
    if (epoch !== this.epoch) return;
    if (result.safety) this.showSafety('ai');
    this.set({ analysis: result });
  }

  // ---------------------------------------------------------------- Showing steps

  /** Starts moving to a step: keeps the current one for Back, applies the answer, shows the next. */
  private go(next: StepId, change: Partial<Answers> = {}, options: ShowOptions = {}): void {
    const snapshot = this.snapshot();
    this.set((s) => ({
      answers: { ...s.answers, ...change },
      history: snapshot ? [...s.history, snapshot] : s.history,
      confirm: null,
      retry: null,
      step: null,
    }));
    void this.run((epoch) => this.show(next, epoch, options));
  }

  private snapshot(): Snapshot | null {
    const s = this.state;
    if (!s.step || !s.entry) return null;
    return {
      step: s.step,
      answers: s.answers,
      itemsLen: s.entry.itemsLen,
      texts: s.entry.texts,
      analysis: s.entry.analysis,
      results: s.results,
      recommendations: s.recommendations,
      countyCandidate: s.countyCandidate,
      form: s.form && this.draft ? { ...s.form, values: this.draft } : s.form,
    };
  }

  /** What the assistant asks at a step. Used when it first shows the step and when it repeats it. */
  private questionFor(step: StepId): string[] {
    const { answers: a, countyCandidate, recommendations } = this.state;
    switch (step) {
      case 'welcome':
        return [copy.steps.welcome.message];
      case 'pro_info':
        return [
          this.deps.config.links.join
            ? copy.steps.proInfo.message
            : copy.steps.proInfo.messageNoLink,
        ];
      case 'location':
        return [copy.steps.location.message];
      case 'uk':
        return [copy.steps.uk.message];
      case 'outside':
        return [copy.steps.outside.message];
      case 'county':
        return [fill(copy.steps.county.message, { state: a.stateName ?? '' })];
      case 'county_help':
        return [copy.steps.countyHelp.message];
      case 'county_confirm':
        return [fill(copy.steps.countyHelp.confirm, { county: countyCandidate?.name ?? '' })];
      case 'stage':
        return [copy.steps.stage.message];
      case 'situation':
        return [copy.steps.situation.message];
      case 'category':
        return [copy.steps.category.message];
      case 'category_more':
        return [copy.steps.categoryMore.message];
      case 'category_help':
        return [
          recommendations ? copy.steps.categoryHelp.recommended : copy.steps.categoryHelp.explain,
        ];
      case 'subcategory':
        return [copy.steps.subcategory.message];
      case 'results':
        // One message, so the list starts right under its introduction.
        return [
          `${fill(copy.steps.results.message, {
            category: a.category ? copy.categoriesPlural[a.category] : '',
            county: a.countyName ?? '',
            state: a.stateName ?? '',
          })}\n${copy.steps.results.instructions}`,
        ];
      case 'no_match':
        return [
          fill(copy.steps.noMatch.message, {
            categoryWithArticle: a.category ? copy.categoriesWithArticle[a.category] : '',
            county: a.countyName ?? '',
          }),
        ];
      case 'contact':
        return [fill(copy.steps.contact.message, { names: joinNames(this.selectedNames()) })];
      case 'tracy':
        return [copy.steps.tracy.message];
      case 'done':
        return this.doneMessages();
      default:
        return [];
    }
  }

  /** The names of the professionals the visitor picked, in the order they picked them. */
  private selectedNames(): string[] {
    const { results } = this.state;
    if (!results) return [];
    return results.selected
      .map((id) => results.cards.find((card) => card.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  }

  /** Prepares a step (loads what it needs), says its question, and makes it the current step. */
  private async show(step: StepId, epoch: number, options: ShowOptions = {}): Promise<void> {
    const retry = () => void this.run((next) => this.show(step, next, options));
    try {
      let skipTo: StepId | null = null;

      switch (step) {
        case 'location':
          await this.ensureStates();
          break;
        case 'county':
          if (this.state.answers.state) await this.ensureCounties(this.state.answers.state);
          break;
        case 'situation':
          // The visitor already told us about their situation: don't ask again.
          if (this.state.texts.length > 0) skipTo = 'category';
          break;
        case 'category':
        case 'category_more':
          await this.ensureAnalysis(epoch);
          break;
        case 'category_help':
          await this.prepareCategoryHelp(epoch);
          break;
        case 'results': {
          const found = await this.search(epoch, retry);
          if (found === 'stale') return;
          if (found === 'none') return this.show('no_match', epoch);
          if (found === 'failed') return;
          break;
        }
        default:
          break;
      }
      if (epoch !== this.epoch) return;
      if (skipTo) return this.show(skipTo, epoch, options);

      if (!(await this.botSays(options.messages ?? this.questionFor(step), epoch))) return;
      this.finishShow(step, epoch);
    } catch (error) {
      this.fail(epoch, retry, error);
    }
  }

  /** Makes the step current, now that its messages are on screen. */
  private finishShow(step: StepId, epoch: number): void {
    const { answers } = this.state;
    let form = null;
    if (step === 'contact' || step === 'tracy') {
      form = {
        kind: step === 'contact' ? ('pros' as const) : ('tracy' as const),
        values: emptyContact(
          prefillMessage({
            analysis: this.state.analysis,
            texts: this.state.texts,
            stage: answers.stage,
            category: answers.category,
            countyName: answers.countyName,
            stateName: answers.stateName,
            outside: answers.tracyReason === 'outside',
          }),
        ),
        submitting: false,
        error: null,
      };
      this.draft = form.values;
    }
    if (epoch !== this.epoch) return;

    this.set((s) => ({
      step,
      stepSeq: s.stepSeq + 1,
      focus: this.nextFocus,
      busy: false,
      form: step === 'contact' || step === 'tracy' ? form : null,
      results: step === 'results' || step === 'contact' ? s.results : null,
      done: step === 'done' ? s.done : null,
      countyCandidate: step === 'county_confirm' ? s.countyCandidate : null,
      recommendations: step === 'category_help' ? s.recommendations : null,
      entry: { itemsLen: s.items.length, texts: s.texts, analysis: s.analysis },
    }));
    this.deps.tracker.track('step_viewed', { step });
    if (step === 'pro_info') this.deps.tracker.track('branch', { branch: 'pro' });
    if (step === 'uk') this.deps.tracker.track('branch', { branch: 'uk' });
    if (step === 'outside') this.deps.tracker.track('branch', { branch: 'outside' });
    this.nextFocus = 'input';
    if (step === 'done' && this.state.done?.safety) this.showSafety('keyword');
  }

  private async ensureStates(): Promise<void> {
    if (this.state.lists.states.length > 0) return;
    const states = await this.deps.api.states();
    this.set((s) => ({ lists: { ...s.lists, states } }));
  }

  private async ensureCounties(state: string): Promise<void> {
    if (this.state.lists.countiesFor === state) return;
    const counties = await this.deps.api.counties(state);
    this.set((s) => ({ lists: { ...s.lists, counties, countiesFor: state } }));
  }

  /** The recommendations for a visitor who isn't sure; the static list when there is nothing to go on. */
  private async prepareCategoryHelp(epoch: number): Promise<void> {
    this.set({ recommendations: null });
    if (this.state.texts.length === 0) return;
    await this.ensureAnalysis(epoch);
    const { analysis, texts, answers } = this.state;
    const summary = analysis?.source === 'ai' ? analysis.summary : texts.join(' ').slice(0, 1000);
    try {
      const result = await this.deps.api.recommend({
        sessionId: this.deps.sessionId,
        site: this.deps.site,
        stage: answers.stage,
        summary,
      });
      if (epoch === this.epoch && result.recommendations.length > 0) {
        this.set({ recommendations: result.recommendations });
      }
    } catch {
      // The static explanations are the fallback.
    }
  }

  /** Looks for professionals. `none` means no match; `failed` shows the Try again button. */
  private async search(
    epoch: number,
    retry: () => void,
  ): Promise<'found' | 'none' | 'failed' | 'stale'> {
    const { answers } = this.state;
    if (!answers.state || !answers.countyFips || !answers.category) return 'failed';
    let match;
    try {
      match = await this.deps.api.match({
        sessionId: this.deps.sessionId,
        site: this.deps.site,
        state: answers.state,
        countyFips: answers.countyFips,
        category: answers.category,
        subcategory: answers.subcategory === 'any' ? null : answers.subcategory,
      });
    } catch (error) {
      if (epoch !== this.epoch) return 'stale';
      this.fail(epoch, retry, error);
      return 'failed';
    }
    if (epoch !== this.epoch) return 'stale';

    if (match.noMatch) {
      this.deps.tracker.track('no_match', {
        category: answers.category,
        state: answers.state,
        countyFips: answers.countyFips,
      });
      return 'none';
    }
    this.deps.tracker.track('results_shown', {
      platinum: match.counts.platinum,
      gold: match.counts.gold,
      silver: match.counts.silver,
      total: match.total,
      category: answers.category,
      state: answers.state,
    });
    this.set({
      results: { cards: match.results, counts: match.counts, shown: SHOW_MORE_STEP, selected: [] },
    });
    return 'found';
  }

  // ---------------------------------------------------------------- The contact form

  private async sendForm(
    kind: 'pros' | 'tracy',
    values: ContactValues,
    epoch: number,
  ): Promise<void> {
    const s = this.state;
    const { answers } = s;
    const contact = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      email: values.email.trim(),
      phone: values.phone.trim() || null,
      preferredContact: values.preferredContact,
      message: values.message.trim(),
      consent: true as const,
      // The honeypot: people never fill it in.
      website: values.trap,
      sessionId: this.deps.sessionId,
      site: this.deps.site,
      stage: answers.stage,
    };
    try {
      if (kind === 'pros') {
        if (!answers.state || !answers.countyFips || !answers.category || !s.results) {
          throw new Error('The search is incomplete');
        }
        const response = await this.deps.api.lead({
          ...contact,
          state: answers.state,
          countyFips: answers.countyFips,
          category: answers.category,
          subcategory: answers.subcategory === 'any' ? null : answers.subcategory,
          memberIds: s.results.selected,
        });
        if (epoch !== this.epoch) return;
        this.finishForm({ kind, names: response.contacted, safety: response.safety });
      } else {
        const reason = answers.tracyReason ?? 'no_match';
        const response = await this.deps.api.tracy({
          ...contact,
          reason,
          state: reason === 'no_match' ? answers.state : null,
          countyFips: reason === 'no_match' ? answers.countyFips : null,
          category: reason === 'no_match' ? answers.category : null,
          subcategory:
            reason === 'no_match' && answers.subcategory !== 'any' ? answers.subcategory : null,
        });
        if (epoch !== this.epoch) return;
        this.finishForm({ kind, names: [], safety: response.safety });
      }
    } catch (error) {
      if (epoch !== this.epoch || !this.state.form) return;
      const message =
        error instanceof ApiError && error.rateLimited
          ? copy.widget.rateLimited
          : copy.form.submitError;
      this.set({ form: { ...this.state.form, submitting: false, error: message } });
    }
  }

  private finishForm(done: { kind: 'pros' | 'tracy'; names: string[]; safety: boolean }): void {
    this.set({ done: { kind: done.kind, names: done.names, safety: done.safety } });
    this.go('done');
  }

  // ---------------------------------------------------------------- The done step's messages

  /** What the last screen says: the confirmation, then the next steps. */
  private doneMessages(): string[] {
    const { done } = this.state;
    const first =
      done?.kind === 'tracy'
        ? copy.steps.done.messageTracy
        : fill(copy.steps.done.message, { names: joinNames(done?.names ?? []) });
    return [first, copy.steps.whatsNext.message];
  }

  // ---------------------------------------------------------------- Safety

  /** The static safety card, once per session (spec: "Safety"). */
  private showSafety(trigger: 'keyword' | 'ai'): void {
    if (this.state.safetyShown) return;
    this.set((s) => ({
      safetyShown: true,
      items: [...s.items, { id: this.nextId++, kind: 'safety', text: '' }],
    }));
    this.deps.tracker.track('safety_shown', { trigger });
  }

  // ---------------------------------------------------------------- Plumbing

  private add(kind: Item['kind'], text: string): void {
    this.set((s) => ({ items: [...s.items, { id: this.nextId++, kind, text }] }));
  }

  /** Waits like a person typing. False if the visitor moved on (Back, Start over) meanwhile. */
  private async wait(epoch: number): Promise<boolean> {
    const ms = this.deps.typingDelayMs;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    else await Promise.resolve();
    return epoch === this.epoch;
  }

  /** The assistant says each message after a typing pause. False if the visitor moved on. */
  private async botSays(texts: readonly string[], epoch: number): Promise<boolean> {
    for (const text of texts) {
      if (!text) continue;
      this.set({ busy: true });
      if (!(await this.wait(epoch))) return false;
      this.add('bot', text);
    }
    return epoch === this.epoch;
  }

  /**
   * Runs work that takes time: the typing indicator shows (busy) and no input is accepted.
   * A step that moves on from inside a run starts a second one, so the indicator goes off only
   * when the last run of the epoch ends, not when the first one hands over.
   */
  private run(work: (epoch: number) => Promise<void>): Promise<void> {
    const epoch = this.epoch;
    if (this.runs.epoch !== epoch) this.runs = { epoch, count: 0 };
    this.runs.count += 1;
    this.set({ busy: true, retry: null });
    return work(epoch)
      .catch((error: unknown) => this.fail(epoch, () => this.restart(), error))
      .finally(() => {
        if (this.runs.epoch === epoch) this.runs.count -= 1;
        if (epoch === this.epoch && this.runs.count === 0) this.set({ busy: false });
      });
  }

  /** A failure the visitor can recover from: a friendly message and a Try again button. */
  private fail(epoch: number, retry: () => void, error?: unknown): void {
    if (epoch !== this.epoch) return;
    const message =
      error instanceof ApiError && error.rateLimited
        ? copy.widget.rateLimited
        : copy.widget.requestError;
    this.set((s) => ({
      items: [...s.items, { id: this.nextId++, kind: 'bot', text: message }],
      step: null,
      retry,
      busy: false,
    }));
  }

  private set(change: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)): void {
    this.state = { ...this.state, ...(typeof change === 'function' ? change(this.state) : change) };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
