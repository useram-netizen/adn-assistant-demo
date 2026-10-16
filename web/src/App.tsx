import { useEffect, useState } from 'react';
import { copy } from '@adn/copy';
import { ChatLayout } from './chat/ChatLayout';
import { Composer } from './chat/Composer';
import { Conversation } from './chat/Conversation';
import { BotMessage, TypingIndicator } from './chat/Messages';
import { loadPublicConfig, type PublicConfig } from './lib/api';
import type { EmbedContext } from './lib/embedContext';

export const DEFAULT_TYPING_DELAY_MS = 600;

type LoadState =
  { status: 'loading' } | { status: 'ready'; config: PublicConfig } | { status: 'error' };

interface AppProps {
  embed: EmbedContext;
  typingDelayMs?: number;
}

const noop = () => {};

export function App({ embed, typingDelayMs = DEFAULT_TYPING_DELAY_MS }: AppProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const request = loadPublicConfig();
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
  }, [attempt]);

  if (load.status === 'ready') {
    return <Conversation embed={embed} config={load.config} typingDelayMs={typingDelayMs} />;
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
      composer={<Composer disabled canGoBack={false} onBack={noop} onRestart={noop} onSay={noop} />}
    >
      {load.status === 'loading' ? (
        <TypingIndicator />
      ) : (
        <>
          <BotMessage id="adn-load-error">{copy.widget.loadError}</BotMessage>
          <div className="adn-input" role="group" aria-labelledby="adn-load-error">
            <button type="button" className="adn-option" onClick={retry}>
              {copy.widget.retry}
            </button>
          </div>
        </>
      )}
    </ChatLayout>
  );
}
