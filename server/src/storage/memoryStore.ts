import type { DateRange, EventRecord, GapRecord, Lead, LeadRecipient } from '../domain/types.js';
import { log } from '../lib/log.js';
import { inRange } from './range.js';
import type { LeadStore, StoreOperation } from './types.js';

/** The error a MemoryStore operation rejects with while it is in `failing`. */
export class MemoryStoreFailure extends Error {
  override name = 'MemoryStoreFailure';
  readonly code = 'memory_store_failure';

  constructor(readonly operation: StoreOperation) {
    super(`MemoryStore.${operation} failed (failure injected by a test)`);
  }
}

/**
 * Keeps everything in memory: the Store for tests. Records are copied on the way in and out, as a
 * real database would, so a test can't change what was stored by accident. Any operation can be
 * made to fail: `store.failing.add('saveGap')` (init and close never fail, like the real stores).
 */
export class MemoryStore implements LeadStore {
  readonly kind = 'memory';
  /** Operations that reject with a MemoryStoreFailure until removed again. */
  readonly failing = new Set<StoreOperation>();

  private leads: Lead[] = [];
  private readonly gaps: GapRecord[] = [];
  private readonly events: EventRecord[] = [];

  init(): Promise<void> {
    return Promise.resolve();
  }

  /** Saving a lead again (same id) replaces it, like the other stores. */
  saveLead(lead: Lead): Promise<void> {
    return this.run('saveLead', () => {
      const copy = structuredClone(lead);
      const index = this.leads.findIndex((saved) => saved.id === lead.id);
      if (index === -1) this.leads.push(copy);
      else this.leads[index] = copy;
    });
  }

  updateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<void> {
    return this.run('updateLeadRecipients', () => {
      if (!this.replaceRecipients(leadId, recipients)) {
        log.warn('lead_not_found', { store: this.kind, leadId });
      }
    });
  }

  tryUpdateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<boolean> {
    return this.run('updateLeadRecipients', () => this.replaceRecipients(leadId, recipients));
  }

  saveGap(gap: GapRecord): Promise<void> {
    return this.run('saveGap', () => {
      this.gaps.push(structuredClone(gap));
    });
  }

  saveEvents(events: EventRecord[]): Promise<void> {
    return this.run('saveEvents', () => {
      this.events.push(...events.map((event) => structuredClone(event)));
    });
  }

  listLeads(range?: DateRange): Promise<Lead[]> {
    return this.run('listLeads', () =>
      this.leads
        .filter((lead) => inRange(lead.createdAt, range))
        .map((lead) => structuredClone(lead)),
    );
  }

  listGaps(range?: DateRange): Promise<GapRecord[]> {
    return this.run('listGaps', () =>
      this.gaps.filter((gap) => inRange(gap.createdAt, range)).map((gap) => structuredClone(gap)),
    );
  }

  listEvents(range?: DateRange): Promise<EventRecord[]> {
    return this.run('listEvents', () =>
      this.events
        .filter((event) => inRange(event.at, range))
        .map((event) => structuredClone(event)),
    );
  }

  /** Leads whose createdAt can't be parsed are kept, as in the other stores. */
  deleteLeadsBefore(cutoff: Date): Promise<number> {
    return this.run('deleteLeadsBefore', () => {
      const before = this.leads.length;
      this.leads = this.leads.filter((lead) => !(Date.parse(lead.createdAt) < cutoff.getTime()));
      return before - this.leads.length;
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  private replaceRecipients(leadId: string, recipients: LeadRecipient[]): boolean {
    const lead = this.leads.find((saved) => saved.id === leadId);
    if (!lead) return false;
    lead.recipients = structuredClone(recipients);
    return true;
  }

  /** Runs the operation, or rejects when a test made it fail. A throwing task rejects too. */
  private run<T>(operation: StoreOperation, task: () => T): Promise<T> {
    if (this.failing.has(operation)) return Promise.reject(new MemoryStoreFailure(operation));
    return new Promise<T>((resolve) => resolve(task()));
  }
}
