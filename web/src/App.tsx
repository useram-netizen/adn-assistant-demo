import { copy } from '@adn/copy';
import { useEffect, useMemo, useState } from 'react';
import { ChatLayout } from './chat/ChatLayout';
import { Composer } from './chat/Composer';
import { Conversation } from './chat/Conversation';
import { BotMessage, TypingIndicator } from './chat/Messages';
import { ChatController } from './flow/controller';
import { createApi, loadPublicConfig, type Api, type PublicConfig } from './lib/api';
import type { EmbedContext } from './lib/embedContext';
import { createTracker, type Tracker } from './lib/events';
import { newSessionId } from './lib/session';

export const DEFAULT_TYPING_DELAY_MS = 600;

type LoadState =
  { status: 'loading' } | { status: 'ready'; config: PublicConfig } | { status: 'error' };

interface AppProps {
  embed: EmbedContext;
  typingDelayMs?: number;
  /** For tests: the server calls. */
  api?: Api;
  /** For tests: where usage events go. */
  tracker?: Tracker;
}

const noop = () => {};

export function App({ embed, typingDelayMs = DEFAULT_TYPING_DELAY_MS, api, tracker }: AppProps) {
  const client = useMemo(() => api ?? createApi(), [api]);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const request = loadPublicConfig(client);
    request.promise.then(
      (config) => {
        if (active) setLoad({ status: 'ready', config });
      },
      () => {
        if (active) setLoad({ status: 'error' });
      },
    );
    return () => {
      active = false;
      request.cancel();
    };
  }, [client, attempt]);

  const config = load.status === 'ready' ? load.config : null;
  // One conversation per visit, created once the settings are known.
  const controller = useMemo(() => {
    if (!config) return null;
    const sessionId = newSessionId();
    return new ChatController({
      api: client,
      config,
      sessionId,
      site: embed.site,
      mode: embed.mode,
      tracker: tracker ?? createTracker(client, sessionId, embed.site),
      typingDelayMs,
    });
  }, [config, client, embed.site, embed.mode, tracker, typingDelayMs]);

  if (config && controller) {
    return <Conversation embed={embed} config={config} controller={controller} />;
  }

  const retry = () => {
    setLoad({ status: 'loading' });
    setAttempt((count) => count + 1);
  };

  return (
    <ChatLayout
      embed={embed}
      privacyUrl={null}
      reportHeight={load.status === 'error'}
      scrollKey={load.status}
      composer={
        <Composer
          disabled
          canGoBack={false}
          canRestart={false}
          onBack={noop}
          onRestart={noop}
          onSay={noop}
        />
      }
    >
      {load.status === 'loading' ? (
        <TypingIndicator />
      ) : (
        <>
          <BotMessage id="adn-load-error">{copy.widget.loadError}</BotMessage>
          <div className="adn-input" role="group" aria-labelledby="adn-load-error">
            <button
              type="button"
              className="adn-primary"
              onClick={retry}
              ref={(button) => button?.focus({ preventScroll: true })}
            >
              {copy.widget.retry}
            </button>
          </div>
        </>
      )}
    </ChatLayout>
  );
}
