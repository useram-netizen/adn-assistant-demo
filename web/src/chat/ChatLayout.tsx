import { copy } from '@adn/copy';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { EmbedContext } from '../lib/embedContext';
import { Footer } from './Footer';
import { HeartIcon } from './icons';
import { useEscapeToClose, useReportHeight } from './useEmbedBridge';

interface ChatLayoutProps {
  embed: EmbedContext;
  privacyUrl: string | null;
  /** Messages and the current step's input. */
  children: ReactNode;
  composer: ReactNode;
  /** Changes whenever something is added to the conversation, to scroll to the newest message. */
  scrollKey: unknown;
  /** Scroll to the bottom when `scrollKey` changes (false for long screens the caller scrolls itself). */
  pinToBottom?: boolean;
  /**
   * The conversation has nothing else to focus (the assistant is typing, or the step is answered in
   * the text box), so keyboard users need to be able to focus it to scroll it.
   */
  focusableLog?: boolean;
  /** Report the height to embed.js. Off while loading, so the iframe doesn't shrink and grow again. */
  reportHeight: boolean;
  logRef?: RefObject<HTMLDivElement | null>;
}

/** The widget's frame: header, conversation, composer and footer. */
export function ChatLayout({
  embed,
  privacyUrl,
  children,
  composer,
  scrollKey,
  pinToBottom = true,
  focusableLog = false,
  reportHeight,
  logRef,
}: ChatLayoutProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const ownLogRef = useRef<HTMLDivElement>(null);
  const log = logRef ?? ownLogRef;
  const logContentRef = useRef<HTMLDivElement>(null);

  useReportHeight(embed.framed && embed.mode === 'inline' && reportHeight, {
    shell: shellRef,
    log,
    logContent: logContentRef,
  });
  useEscapeToClose(embed.framed && embed.mode === 'bubble');

  // Keep the newest message in view. Only the message list scrolls, never the host page.
  useLayoutEffect(() => {
    const element = log.current;
    if (element && pinToBottom) element.scrollTop = element.scrollHeight;
  }, [log, scrollKey, pinToBottom]);

  return (
    <div className="adn-shell" data-mode={embed.mode} ref={shellRef}>
      <header className="adn-header">
        <span className="adn-logo" aria-hidden="true">
          <HeartIcon />
        </span>
        <div className="adn-heading">
          <h1 className="adn-title">{copy.widget.headerTitle}</h1>
          <p className="adn-subtitle">{copy.widget.headerSubtitle}</p>
        </div>
      </header>
      <div className="adn-log" tabIndex={focusableLog ? 0 : -1} ref={log}>
        <div className="adn-log-content" ref={logContentRef}>
          {children}
        </div>
      </div>
      <div className="adn-bottom">
        {composer}
        <Footer privacyUrl={privacyUrl} />
      </div>
    </div>
  );
}
