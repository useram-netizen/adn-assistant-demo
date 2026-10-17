import type { Ref } from 'react';
import type { OptionItem } from '../flow/options';
import { ChevronIcon } from './icons';

interface OptionListProps {
  options: readonly OptionItem[];
  onChoose: (id: string) => void;
  /** id of the bot message that asks the question, used as the group's label. */
  labelledBy?: string;
  ref?: Ref<HTMLDivElement>;
}

/** The buttons that answer a step. Each is a real button. */
export function OptionList({ options, onChoose, labelledBy, ref }: OptionListProps) {
  if (options.length === 0) return null;
  return (
    <div className="adn-options" role="group" aria-labelledby={labelledBy} ref={ref}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="adn-option"
          onClick={() => onChoose(option.id)}
        >
          <span className="adn-option-text">
            <span className="adn-option-label">
              {option.label}
              {option.tag && <span className="adn-tag">{option.tag}</span>}
            </span>
            {option.description && <span className="adn-option-desc">{option.description}</span>}
          </span>
          <ChevronIcon />
        </button>
      ))}
    </div>
  );
}
