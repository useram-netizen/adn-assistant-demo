import { copy } from '@adn/copy';
import { useId, useState, type FormEvent, type KeyboardEvent, type Ref } from 'react';
import { BackIcon, RestartIcon, SendIcon } from './icons';

/** The spec's limit for visitor text. */
export const MAX_TEXT_LENGTH = 1000;
const MAX_TEXTAREA_HEIGHT = 120;

interface ComposerProps {
  /** Nothing can be typed or sent (while the assistant loads or after an error). */
  disabled?: boolean;
  /** The bot is typing: text can be written but not sent yet. */
  busy?: boolean;
  /** Hide the text box (while a form is showing). Back and Start over stay. */
  hideText?: boolean;
  placeholder?: string;
  canGoBack: boolean;
  canRestart: boolean;
  onBack: () => void;
  onRestart: () => void;
  onSay: (text: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

/** Back and Start over, plus the text box that is always available. */
export function Composer({
  disabled = false,
  busy = false,
  hideText = false,
  placeholder = copy.widget.inputPlaceholder,
  canGoBack,
  canRestart,
  onBack,
  onRestart,
  onSay,
  textareaRef,
}: ComposerProps) {
  const [text, setText] = useState('');
  const inputId = useId();
  const canSend = !disabled && !busy && text.trim().length > 0;

  const fitHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  };

  const send = (textarea: HTMLTextAreaElement | null) => {
    if (!canSend) return;
    onSay(text.trim());
    setText('');
    if (textarea) {
      textarea.style.height = '';
      // Keep focus in the text box (the send button turns disabled once the box is empty).
      textarea.focus();
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send(event.currentTarget.querySelector('textarea'));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(event.currentTarget);
    }
  };

  return (
    <div className="adn-composer">
      <div className="adn-nav">
        <button type="button" className="adn-nav-button" onClick={onBack} disabled={!canGoBack}>
          <BackIcon />
          {copy.widget.back}
        </button>
        <button type="button" className="adn-nav-button" onClick={onRestart} disabled={!canRestart}>
          <RestartIcon />
          {copy.widget.startOver}
        </button>
      </div>
      <form className="adn-text-row" onSubmit={onSubmit} hidden={hideText}>
        <label htmlFor={inputId} className="adn-sr-only">
          {copy.widget.inputLabel}
        </label>
        <textarea
          id={inputId}
          ref={textareaRef}
          className="adn-textarea"
          rows={1}
          maxLength={MAX_TEXT_LENGTH}
          placeholder={placeholder}
          autoComplete="off"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            fitHeight(event.target);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          className="adn-send"
          aria-label={copy.widget.send}
          disabled={!canSend}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
