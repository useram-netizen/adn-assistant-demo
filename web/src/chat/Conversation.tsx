import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import { canGoBack, conversationReducer, initialConversation } from '../flow/conversation';
import { fallbackReply, stepView } from '../flow/steps';
import type { PublicConfig } from '../lib/api';
import type { EmbedContext } from '../lib/embedContext';
import { ChatLayout } from './ChatLayout';
import { Composer } from './Composer';
import { BotMessage, StepInput, TypingIndicator, VisitorMessage } from './Messages';

interface ConversationProps {
  embed: EmbedContext;
  config: PublicConfig;
  /** How long the typing indicator shows before each bot message. */
  typingDelayMs: number;
}

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled)';

export function Conversation({ embed, config, typingDelayMs }: ConversationProps) {
  const [state, dispatch] = useReducer(conversationReducer, undefined, initialConversation);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const appliedFocus = useRef(0);

  const current = state.turns.at(-1);
  const currentStep = current?.step;
  const currentView = current ? stepView(current.step, config) : null;

  // The bot "types" for a moment, then shows the next step or its reply.
  useEffect(() => {
    const pending = state.pending;
    if (!pending) return;
    const timer = setTimeout(() => {
      if (pending.kind === 'step') {
        dispatch({ type: 'reveal' });
      } else if (currentStep) {
        dispatch({ type: 'reply', text: fallbackReply(stepView(currentStep, config)) });
      }
    }, typingDelayMs);
    return () => clearTimeout(timer);
  }, [state.pending, currentStep, config, typingDelayMs]);

  // After the visitor acts, move focus to the new input (or back to the text box).
  useEffect(() => {
    const request = state.focus;
    if (!request || state.pending || request.seq === appliedFocus.current) return;
    appliedFocus.current = request.seq;
    if (request.target === 'composer') {
      textareaRef.current?.focus({ preventScroll: true });
      return;
    }
    const target = inputRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? logRef.current;
    target?.focus({ preventScroll: true });
  }, [state.focus, state.pending]);

  const transcript: ReactNode[] = [];
  let questionId: string | undefined;
  for (const turn of state.turns) {
    const view = stepView(turn.step, config);
    view.messages.forEach((text, index) => {
      questionId = `adn-m${turn.id}-${index}`;
      transcript.push(
        <BotMessage key={questionId} id={questionId}>
          {text}
        </BotMessage>,
      );
    });
    for (const aside of turn.asides) {
      transcript.push(<VisitorMessage key={`said${aside.id}`}>{aside.text}</VisitorMessage>);
      if (aside.reply) {
        questionId = `adn-r${aside.id}`;
        transcript.push(
          <BotMessage key={questionId} id={questionId}>
            {aside.reply}
          </BotMessage>,
        );
      }
    }
    if (turn.answer) {
      transcript.push(
        <VisitorMessage key={`answer${turn.id}`}>{turn.answer.label}</VisitorMessage>,
      );
    }
  }

  return (
    <ChatLayout
      embed={embed}
      privacyUrl={config.links.privacy}
      reportHeight={state.turns.length > 0}
      scrollKey={state}
      logRef={logRef}
      composer={
        <Composer
          busy={state.pending !== null}
          canGoBack={canGoBack(state)}
          onBack={() => dispatch({ type: 'back' })}
          onRestart={() => dispatch({ type: 'restart' })}
          onSay={(text) => dispatch({ type: 'say', text })}
          textareaRef={textareaRef}
        />
      }
    >
      {transcript}
      {state.pending ? (
        <TypingIndicator />
      ) : (
        current &&
        currentView &&
        !current.answer && (
          <StepInput
            ref={inputRef}
            view={currentView}
            labelledBy={questionId}
            onChoose={(option) => dispatch({ type: 'choose', option })}
          />
        )
      )}
    </ChatLayout>
  );
}
