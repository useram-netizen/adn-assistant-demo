import type { Store } from '../domain/types.js';
import { log } from '../lib/log.js';

const DAY_MS = 24 * 60 * 60_000;

/**
 * LEAD_RETENTION_DAYS (OPEN): when set, leads older than that are deleted, once at startup and
 * then daily. Unset means leads are kept. Returns a function that stops the job.
 */
export function startLeadRetention(
  store: Pick<Store, 'deleteLeadsBefore'>,
  days: number | undefined,
  now: () => Date = () => new Date(),
): () => void {
  if (!days) return () => undefined;

  const purge = async () => {
    try {
      const deleted = await store.deleteLeadsBefore(new Date(now().getTime() - days * DAY_MS));
      log.info('leads_purged', { days, deleted });
    } catch (error) {
      log.error('leads_purge_failed', { code: error instanceof Error ? error.name : 'unknown' });
    }
  };
  void purge();
  const timer = setInterval(() => void purge(), DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
