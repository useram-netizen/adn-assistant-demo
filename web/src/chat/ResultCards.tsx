import type { ProfessionalCard } from '@adn/api';
import { copy, fill } from '@adn/copy';
import { useEffect, useRef } from 'react';
import { MAX_SELECTED, type ResultsState } from '../flow/types';

interface ResultCardsProps {
  results: ResultsState;
  /** id of the bot message that introduces the list, used as its label. */
  labelledBy?: string;
  onToggle: (id: string) => void;
  onShowMore: () => void;
  onContact: () => void;
}

function Card({
  card,
  selected,
  limitReached,
  onToggle,
}: {
  card: ProfessionalCard;
  selected: boolean;
  limitReached: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="adn-card" data-tier={card.tier} data-selected={selected}>
      <div className="adn-card-main">
        <h2 className="adn-card-name">{card.name}</h2>
        <p className="adn-card-labels">{card.labels.join(' · ')}</p>
        <p className="adn-card-area">{card.serviceArea}</p>
        {card.badges.length > 0 && (
          <ul className="adn-badges" aria-label={copy.cards.badgesLabel}>
            {card.badges.map((badge) => (
              <li key={badge} className={`adn-badge adn-badge--${badge}`}>
                {copy.cards.badges[badge]}
              </li>
            ))}
          </ul>
        )}
        {card.email && (
          <p className="adn-card-contact">
            {copy.steps.results.email}: <a href={`mailto:${card.email}`}>{card.email}</a>
          </p>
        )}
      </div>
      <button
        type="button"
        className="adn-select"
        aria-pressed={selected}
        disabled={!selected && limitReached}
        onClick={onToggle}
      >
        {selected ? copy.steps.results.selected : copy.steps.results.select}{' '}
        <span className="adn-sr-only">{card.name}</span>
      </button>
    </li>
  );
}

/** The matching professionals, 6 at a time, with the select toggles and the contact button. */
export function ResultCards({
  results,
  labelledBy,
  onToggle,
  onShowMore,
  onContact,
}: ResultCardsProps) {
  const { cards, shown, selected } = results;
  const visible = cards.slice(0, shown);
  const limitReached = selected.length >= MAX_SELECTED;
  const listRef = useRef<HTMLUListElement>(null);
  // "Show more" moves the focus to the first card it added, which would otherwise be left behind.
  const focusFrom = useRef<number | null>(null);
  useEffect(() => {
    const index = focusFrom.current;
    if (index === null || visible.length <= index) return;
    focusFrom.current = null;
    const card = listRef.current?.children[index];
    const log = card?.closest<HTMLElement>('.adn-log');
    card?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    if (card && log) {
      log.scrollTop += card.getBoundingClientRect().top - log.getBoundingClientRect().top - 8;
    }
  }, [visible.length]);

  return (
    <div className="adn-results">
      <ul className="adn-cards" aria-labelledby={labelledBy} ref={listRef}>
        {visible.map((card) => (
          <Card
            key={card.id}
            card={card}
            selected={selected.includes(card.id)}
            limitReached={limitReached}
            onToggle={() => onToggle(card.id)}
          />
        ))}
      </ul>
      {shown < cards.length && (
        <button
          type="button"
          className="adn-more"
          onClick={() => {
            focusFrom.current = visible.length;
            onShowMore();
          }}
        >
          {copy.steps.results.showMore}
        </button>
      )}
      <div className="adn-contact-bar">
        {limitReached && (
          <p className="adn-hint" role="status">
            {copy.steps.results.maxReached}
          </p>
        )}
        <button
          type="button"
          className="adn-primary"
          disabled={selected.length === 0}
          onClick={onContact}
        >
          {fill(copy.steps.results.contact, { n: selected.length })}
        </button>
      </div>
    </div>
  );
}
