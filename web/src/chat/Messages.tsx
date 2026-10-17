import { copy } from '@adn/copy';
import type { ReactNode } from 'react';

export function BotMessage({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div className="adn-msg adn-msg--bot" id={id}>
      <span className="adn-sr-only">{copy.widget.assistantSaid}</span> {children}
    </div>
  );
}

/** The visitor's own message. It is not announced again by the live region (they just wrote it). */
export function VisitorMessage({ children }: { children: ReactNode }) {
  return (
    <div className="adn-msg adn-msg--visitor" aria-live="off">
      <span className="adn-sr-only">{copy.widget.youSaid}</span> {children}
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="adn-typing" data-testid="typing" role="status">
      <span className="adn-sr-only">{copy.widget.typing}</span>
      <span className="adn-typing-dot" aria-hidden="true" />
      <span className="adn-typing-dot" aria-hidden="true" />
      <span className="adn-typing-dot" aria-hidden="true" />
    </div>
  );
}

/** The static safety card (spec: "Safety"), shown once per session. */
export function SafetyCard({ onLinkClick }: { onLinkClick: () => void }) {
  return (
    <aside className="adn-safety" aria-label={copy.safety.title}>
      <h2 className="adn-safety-title">{copy.safety.title}</h2>
      <p className="adn-safety-text">{copy.safety.message}</p>
      <ul className="adn-safety-actions">
        {copy.safety.actions.map((action) => (
          <li key={action.href}>
            <a className="adn-safety-link" href={action.href} onClick={onLinkClick}>
              {action.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
