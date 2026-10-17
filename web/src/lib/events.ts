import type { ClientEvent, ClientEventType, EventDataByType } from '@adn/api';
import type { Api } from './api';

/**
 * Usage events (spec: "Tracking"): option values and counts only, never anything the visitor
 * typed and never personal details. Events are collected and sent in batches, and the last
 * ones go out (keepalive) when the page is hidden. A failed send is dropped.
 */
export interface Tracker {
  track<T extends ClientEventType>(type: T, data: EventDataByType[T]): void;
  /** Sends what is waiting now. */
  flush(keepalive?: boolean): void;
  /** Stops the timer. */
  dispose(): void;
}

const BATCH_MS = 4_000;
const MAX_BATCH = 50;

export function createTracker(api: Pick<Api, 'events'>, sessionId: string, site: string): Tracker {
  const queue: ClientEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (keepalive = false) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return;
    const events = queue.splice(0, MAX_BATCH);
    void api.events({ sessionId, site, events }, keepalive);
    if (queue.length > 0) flush(keepalive);
  };

  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush(true);
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', () => flush(true));

  return {
    track(type, data) {
      queue.push({ type, data, at: new Date().toISOString() });
      if (queue.length >= MAX_BATCH) flush();
      else timer ??= setTimeout(() => flush(), BATCH_MS);
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onHidden);
    },
  };
}

/** A tracker that records nothing (tests, and the loading screen). */
export const noTracker: Tracker = {
  track() {},
  flush() {},
  dispose() {},
};
