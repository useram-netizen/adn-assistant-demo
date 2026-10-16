import { copy } from '@adn/copy';
import type { ReactNode, Ref } from 'react';
import { ChevronIcon, ExternalIcon } from './icons';
import type { StepOption, StepView } from '../flow/steps';

export function BotMessage({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div className="adn-msg adn-msg--bot" id={id}>
      <span className="adn-sr-only">{copy.widget.assistantSaid} </span>
      {children}
    </div>
  );
}

export function VisitorMessage({ children }: { children: ReactNode }) {
  return (
    <div className="adn-msg adn-msg--visitor">
      <span className="adn-sr-only">{copy.widget.youSaid} </span>
      {children}
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="adn-typing" data-testid="typing">
      <span className="adn-sr-only">{copy.widget.typing}</span>
      <span className="adn-typing-dot" aria-hidden="true" />
      <span className="adn-typing-dot" aria-hidden="true" />
      <span className="adn-typing-dot" aria-hidden="true" />
    </div>
  );
}

interface StepInputProps {
  view: StepView;
  /** id of the bot message that asks the question, used as the group's label. */
  labelledBy?: string;
  onChoose: (option: StepOption) => void;
  ref?: Ref<HTMLDivElement>;
}

/** The buttons (or link button) that answer the current step. */
export function StepInput({ view, labelledBy, onChoose, ref }: StepInputProps) {
  if (view.options.length === 0 && !view.link) return null;
  return (
    <div className="adn-input" role="group" aria-labelledby={labelledBy} ref={ref}>
      {view.options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="adn-option"
          onClick={() => onChoose(option)}
        >
          <span>{option.label}</span>
          <ChevronIcon />
        </button>
      ))}
      {view.link && (
        <a
          className="adn-link-button"
          href={view.link.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{view.link.label}</span>
          <span className="adn-sr-only"> {copy.widget.opensInNewTab}</span>
          <ExternalIcon />
        </a>
      )}
    </div>
  );
}
