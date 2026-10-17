import type { EventRecord, EventSink, Store } from '../domain/types.js';
import { log } from '../lib/log.js';
import type { EventDataByType, EventType } from '../shared/api.js';

export interface BufferedEventSink extends EventSink {
  /** Writes everything buffered so far. Never throws. */
  flush(): Promise<void>;
}

/**
 * Records events the server itself produces (ai_call, lead_submitted, tracy_form_submitted,
 * email_failed). They are buffered and written in small batches, so recording never slows a
 * request, and a storage error is only logged.
 */
export function createEventSink(
  store: Pick<Store, 'saveEvents'>,
  { flushMs = 2_000, now = () => new Date() }: { flushMs?: number; now?: () => Date } = {},
): BufferedEventSink {
  let buffer: EventRecord[] = [];
  let timer: NodeJS.Timeout | null = null;
  let writing: Promise<void> = Promise.resolve();

  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = buffer;
    buffer = [];
    if (batch.length === 0) return writing;
    writing = writing.then(async () => {
      try {
        await store.saveEvents(batch);
      } catch (error) {
        log.error('events_save_failed', {
          count: batch.length,
          code: error instanceof Error ? error.name : 'unknown',
        });
      }
    });
    return writing;
  }

  return {
    record<T extends EventType>(event: {
      sessionId: string;
      site: string;
      type: T;
      data: EventDataByType[T];
    }): void {
      const at = now().toISOString();
      buffer.push({ ...event, at, receivedAt: at, source: 'server' });
      if (buffer.length >= 50) void flush();
      else if (!timer) {
        timer = setTimeout(() => void flush(), flushMs);
        timer.unref();
      }
    },
    flush,
  };
}
