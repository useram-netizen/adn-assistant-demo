import type { DateRange, EventRecord, GapRecord, Lead, LeadRecipient } from '../domain/types.js';
import { log } from '../lib/log.js';
import { errorCode } from './errors.js';
import type { LeadStore, StoreOperation } from './types.js';

/**
 * MongoDB first, files as the safety net (spec: "never crash or block because the database is
 * missing"). Every write tries the primary store and, if that fails for any reason, goes to the
 * fallback instead. Reads combine both, so data written during an outage still shows up. The
 * log says which operation fell back and why (an error code, never the data).
 */
export class ResilientStore implements LeadStore {
  readonly kind: 'mongo' | 'file' | 'memory';

  constructor(
    private readonly primary: LeadStore,
    private readonly fallback: LeadStore,
  ) {
    this.kind = primary.kind;
  }

  async init(): Promise<void> {
    await Promise.allSettled([this.primary.init(), this.fallback.init()]);
  }

  saveLead(lead: Lead): Promise<void> {
    return this.write('saveLead', (store) => store.saveLead(lead));
  }

  async updateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<void> {
    if (!(await this.tryUpdateLeadRecipients(leadId, recipients))) {
      log.warn('lead_not_found', { store: 'resilient', leadId });
    }
  }

  /** Updates the lead where it is: in the database, or in the files if it was saved during an outage. */
  async tryUpdateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<boolean> {
    try {
      if (await this.primary.tryUpdateLeadRecipients(leadId, recipients)) return true;
    } catch (error) {
      this.fellBack('updateLeadRecipients', error);
    }
    return this.fallback.tryUpdateLeadRecipients(leadId, recipients);
  }

  saveGap(gap: GapRecord): Promise<void> {
    return this.write('saveGap', (store) => store.saveGap(gap));
  }

  saveEvents(events: EventRecord[]): Promise<void> {
    return this.write('saveEvents', (store) => store.saveEvents(events));
  }

  async listLeads(range?: DateRange): Promise<Lead[]> {
    const [primary, fallback] = await this.read('listLeads', (store) => store.listLeads(range));
    // A lead can be in both (saved to the database, updated in the files): the files are newer.
    const byId = new Map(primary.map((lead) => [lead.id, lead]));
    for (const lead of fallback) byId.set(lead.id, lead);
    return [...byId.values()];
  }

  async listGaps(range?: DateRange): Promise<GapRecord[]> {
    return (await this.read('listGaps', (store) => store.listGaps(range))).flat();
  }

  async listEvents(range?: DateRange): Promise<EventRecord[]> {
    return (await this.read('listEvents', (store) => store.listEvents(range))).flat();
  }

  async deleteLeadsBefore(cutoff: Date): Promise<number> {
    const results = await Promise.allSettled([
      this.primary.deleteLeadsBefore(cutoff),
      this.fallback.deleteLeadsBefore(cutoff),
    ]);
    return results.reduce(
      (sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0),
      0,
    );
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.primary.close(), this.fallback.close()]);
  }

  private async write(
    operation: StoreOperation,
    run: (store: LeadStore) => Promise<void>,
  ): Promise<void> {
    try {
      await run(this.primary);
    } catch (error) {
      this.fellBack(operation, error);
      await run(this.fallback);
    }
  }

  /** The records of both stores; a store that can't be read counts as empty. */
  private async read<T>(
    operation: StoreOperation,
    run: (store: LeadStore) => Promise<T>,
  ): Promise<[T, T]> {
    const [primary, fallback] = await Promise.allSettled([run(this.primary), run(this.fallback)]);
    if (primary.status === 'rejected') this.fellBack(operation, primary.reason);
    if (fallback.status === 'rejected') this.fellBack(operation, fallback.reason);
    const empty = [] as unknown as T;
    return [
      primary.status === 'fulfilled' ? primary.value : empty,
      fallback.status === 'fulfilled' ? fallback.value : empty,
    ];
  }

  private fellBack(operation: StoreOperation, error: unknown): void {
    log.warn('storage_fallback', { operation, code: errorCode(error) });
  }
}
