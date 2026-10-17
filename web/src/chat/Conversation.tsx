import { copy } from '@adn/copy';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { ChatController } from '../flow/controller';
import type { ChatState, StepId } from '../flow/types';
import type { PublicConfig } from '../lib/api';
import type { EmbedContext } from '../lib/embedContext';
import { ChatLayout } from './ChatLayout';
import { Composer } from './Composer';
import { BotMessage, SafetyCard, TypingIndicator, VisitorMessage } from './Messages';
import { StepInput } from './StepInput';

interface ConversationProps {
  embed: EmbedContext;
  config: PublicConfig;
  controller: ChatController;
}

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), textarea:not(:disabled)';

/** Long screens: scroll to the start of the question rather than to the bottom. */
const LONG_STEPS: ReadonlySet<StepId> = new Set(['results', 'category_help', 'contact', 'tracy']);

/** The text box's hint at the steps where typing is the answer. */
function placeholderFor(step: StepId | null): string {
  if (step === 'county_help') return copy.steps.countyHelp.placeholder;
  if (step === 'situation') return copy.steps.situation.placeholder;
  return copy.widget.inputPlaceholder;
}

export function Conversation({ embed, config, controller }: ConversationProps) {
  const state = useSyncExternalStore<ChatState>(controller.subscribe, controller.getState);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const appliedSeq = useRef(0);
  const appliedRetry = useRef<unknown>(null);

  // Starts once; safe if React runs this twice in development.
  useEffect(() => {
    controller.start();
  }, [controller]);

  // After the visitor acts, focus goes to the new input (or stays in the text box when they
  // were typing). It never moves on first load, and never out of a box with text in it.
  useEffect(() => {
    if (state.busy || state.stepSeq === appliedSeq.current) return;
    appliedSeq.current = state.stepSeq;
    if (state.focus === 'none') return;
    const textarea = textareaRef.current;
    if (state.focus === 'composer') {
      textarea?.focus({ preventScroll: true });
      return;
    }
    if (textarea && document.activeElement === textarea && textarea.value !== '') return;
    const first = inputRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    // On a touch screen, don't pop up the keyboard just because a dropdown comes first.
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    // Where typing is the answer the text box gets the focus (on a touch screen only when it is
    // the only thing to answer with, as when asking for a city or ZIP code).
    if (state.step === 'county_help' || (state.step === 'situation' && !coarse)) {
      textarea?.focus({ preventScroll: true });
      return;
    }
    const typing = first?.matches('input, textarea') ?? false;
    (typing && coarse ? inputRef.current : (first ?? inputRef.current))?.focus({
      preventScroll: true,
    });
  }, [state.busy, state.stepSeq, state.focus, state.step]);

  // After a failure, focus the Try again button so keyboard users aren't left behind.
  useEffect(() => {
    if (!state.retry || appliedRetry.current === state.retry) return;
    appliedRetry.current = state.retry;
    inputRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [state.retry]);

  const lastBot = [...state.items].reverse().find((item) => item.kind === 'bot');
  const questionId = lastBot ? `adn-m${lastBot.id}` : undefined;

  // Long screens start at their question.
  const scrollToQuestion = !state.busy && state.step !== null && LONG_STEPS.has(state.step);
  useLayoutEffect(() => {
    if (!scrollToQuestion || !questionId) return;
    const log = logRef.current;
    const question = document.getElementById(questionId);
    if (!log || !question) return;
    const offset = question.getBoundingClientRect().top - log.getBoundingClientRect().top;
    log.scrollTop += offset - 8;
  }, [scrollToQuestion, questionId, state.stepSeq]);

  const transcript: ReactNode[] = state.items.map((item) => {
    switch (item.kind) {
      case 'bot':
        return (
          <BotMessage key={item.id} id={`adn-m${item.id}`}>
            {item.text}
          </BotMessage>
        );
      case 'visitor':
        return <VisitorMessage key={item.id}>{item.text}</VisitorMessage>;
      case 'safety':
        return <SafetyCard key={item.id} onLinkClick={() => controller.trackLink('safety')} />;
    }
  });

  const formShowing = state.step === 'contact' || state.step === 'tracy';

  return (
    <ChatLayout
      embed={embed}
      privacyUrl={config.links.privacy}
      reportHeight={state.items.length > 0}
      holdHeight={state.busy}
      scrollKey={`${state.items.length}|${state.step ?? ''}|${state.busy}|${state.confirm ? 1 : 0}|${state.retry ? 1 : 0}`}
      pinToBottom={!scrollToQuestion}
      focusableLog={
        state.busy ||
        state.step === 'county_help' ||
        (state.step === 'pro_info' && !config.links.join) ||
        (state.step === null && !state.retry)
      }
      logRef={logRef}
      composer={
        <Composer
          busy={state.busy}
          hideText={formShowing}
          placeholder={placeholderFor(state.step)}
          canGoBack={controller.canGoBack}
          canRestart={controller.canRestart}
          onBack={() => controller.back()}
          onRestart={() => controller.restart()}
          onSay={(text) => controller.say(text)}
          textareaRef={textareaRef}
        />
      }
    >
      <div
        className="adn-messages"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={copy.widget.conversationLabel}
      >
        {transcript}
      </div>
      {state.busy ? (
        <TypingIndicator />
      ) : (
        <StepInput
          ref={inputRef}
          state={state}
          controller={controller}
          links={config.links}
          labelledBy={questionId}
        />
      )}
    </ChatLayout>
  );
}
