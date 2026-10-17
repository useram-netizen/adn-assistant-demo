import type { EventSink, LeadRecipient, Mailer, OutgoingEmail, Store } from '../domain/types.js';
import { log, redact } from '../lib/log.js';

/**
 * Sends a lead's emails and keeps each recipient's status in the store (spec: "Record each
 * recipient's status, and retry failures up to 3 times").
 *
 * The first attempt for every email runs before the visitor gets a response. A failed email
 * is retried in the background after 30 seconds, 2 minutes and 10 minutes; while retries are
 * left its status stays "pending" (with lastError), and after the last one it is "failed" and
 * an email_failed event is recorded. Retries live in this process: a restart drops them.
 */

/** Waits before the 2nd, 3rd and 4th attempts. */
export const RETRY_DELAYS_MS: readonly number[] = [30_000, 2 * 60_000, 10 * 60_000];

export type SetTimer = (callback: () => void, ms: number) => void;

export interface DeliveryOptions {
  mailer: Mailer;
  store: Store;
  events: EventSink;
  /** One wait per retry (tests pass their own). */
  retryDelaysMs?: readonly number[];
  /** Schedules a retry (tests pass a fake). Defaults to an unref'd setTimeout. */
  setTimer?: SetTimer;
  now?: () => Date;
}

export interface DeliveryJob {
  leadId: string;
  sessionId: string;
  site: string;
  /** The lead's recipients. Updated in place, and stored after each round of attempts. */
  recipients: LeadRecipient[];
  /** The email for each recipient (same order), or null when it cannot be sent at all:
   *  that recipient must already be marked failed. */
  emails: ReadonlyArray<OutgoingEmail | null>;
}

export interface Delivery {
  /** Sends every email once, in parallel, and resolves when those attempts are done. Never throws. */
  deliver(job: DeliveryJob): Promise<void>;
  /** Resolves once no attempt or store update is running (scheduled retries don't count). */
  idle(): Promise<void>;
}

interface ActiveJob extends DeliveryJob {
  /** Store updates run one after another, so the last one written is the newest. */
  writes: Promise<void>;
}

const defaultSetTimer: SetTimer = (callback, ms) => {
  // Pending retries must not keep the process alive on shutdown.
  setTimeout(callback, ms).unref();
};

const SAFE_CODE = /^[\w.-]{1,40}$/;

/** A short, non-personal description of a sending error, for logs and lastError. */
export function sendErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'send_failed';
  const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
  const name = error instanceof Error ? error.name : undefined;
  const base =
    typeof code === 'string' && SAFE_CODE.test(code)
      ? code
      : name && SAFE_CODE.test(name)
        ? name
        : 'send_failed';
  return typeof responseCode === 'number' ? `${base} ${responseCode}` : base;
}

export function createDelivery(options: DeliveryOptions): Delivery {
  const { mailer, store, events } = options;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const now = options.now ?? (() => new Date());
  const inFlight = new Set<Promise<void>>();

  /** Keeps background work visible to idle(); a failure is logged, never unhandled. */
  function track(work: Promise<unknown>): void {
    const tracked = work.then(
      () => undefined,
      (error: unknown) => {
        log.error('email_delivery_error', { error: sendErrorCode(error) });
      },
    );
    inFlight.add(tracked);
    void tracked.then(() => inFlight.delete(tracked));
  }

  function persist(job: ActiveJob): void {
    const snapshot = job.recipients.map((recipient) => ({ ...recipient }));
    job.writes = job.writes.then(async () => {
      try {
        await store.updateLeadRecipients(job.leadId, snapshot);
      } catch (error) {
        // The store's error text may contain personal details: name the lead only.
        log.error('lead_store_failed', {
          leadId: job.leadId,
          op: 'update_recipients',
          error: sendErrorCode(error),
        });
      }
    });
    track(job.writes);
  }

  /** One attempt for one recipient. Returns whether it worked. */
  async function attempt(job: ActiveJob, index: number, email: OutgoingEmail): Promise<boolean> {
    const recipient = job.recipients[index];
    if (!recipient) return false;
    recipient.attempts += 1;
    try {
      const result = await mailer.send(email);
      recipient.status = result.status;
      delete recipient.lastError;
      log.info('email_sent', {
        leadId: job.leadId,
        kind: email.kind,
        status: result.status,
        attempt: recipient.attempts,
      });
      return true;
    } catch (error) {
      recipient.lastError = sendErrorCode(error);
      log.warn('email_send_failed', {
        leadId: job.leadId,
        kind: email.kind,
        mode: mailer.mode,
        attempt: recipient.attempts,
        code: recipient.lastError,
        detail: error instanceof Error ? redact(error.message).slice(0, 300) : undefined,
      });
      return false;
    } finally {
      recipient.updatedAt = now().toISOString();
    }
  }

  function giveUp(job: ActiveJob, index: number): void {
    const recipient = job.recipients[index];
    if (!recipient) return;
    recipient.status = 'failed';
    log.error('email_failed', {
      leadId: job.leadId,
      kind: recipient.kind,
      attempts: recipient.attempts,
      code: recipient.lastError,
    });
    try {
      events.record({
        sessionId: job.sessionId,
        site: job.site,
        type: 'email_failed',
        data: { kind: recipient.kind, attempts: recipient.attempts },
      });
    } catch (error) {
      log.error('event_record_failed', { type: 'email_failed', error: sendErrorCode(error) });
    }
  }

  /** After a failed attempt: schedule the next one, or give up when none are left. */
  function afterFailure(job: ActiveJob, index: number, email: OutgoingEmail): void {
    const recipient = job.recipients[index];
    if (!recipient) return;
    const delay = delays[recipient.attempts - 1];
    if (delay === undefined) {
      giveUp(job, index);
      return;
    }
    recipient.status = 'pending';
    setTimer(() => track(retry(job, index, email)), delay);
  }

  async function retry(job: ActiveJob, index: number, email: OutgoingEmail): Promise<void> {
    const sent = await attempt(job, index, email);
    if (!sent) afterFailure(job, index, email);
    persist(job);
  }

  async function firstAttempts(job: ActiveJob): Promise<void> {
    const sends = job.emails.flatMap((email, index) => (email ? [{ email, index }] : []));
    // Recipients that cannot be sent at all were marked failed by the caller.
    job.emails.forEach((email, index) => {
      if (!email) giveUp(job, index);
    });
    const results = await Promise.all(sends.map(({ email, index }) => attempt(job, index, email)));
    sends.forEach(({ email, index }, n) => {
      if (!results[n]) afterFailure(job, index, email);
    });
    persist(job);
  }

  return {
    async deliver(input: DeliveryJob): Promise<void> {
      const job: ActiveJob = { ...input, writes: Promise.resolve() };
      const work = firstAttempts(job);
      track(work);
      await work.catch(() => undefined);
    },

    async idle(): Promise<void> {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}
