import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DateRange, EventRecord, GapRecord, Lead, LeadRecipient } from '../domain/types.js';
import { log } from '../lib/log.js';
import { errorCode, StoreClosedError } from './errors.js';
import { inRange } from './range.js';
import type { LeadStore } from './types.js';

/**
 * The Store used when MONGODB_URI is not set: JSON Lines files in one folder.
 *
 * - gaps.jsonl and events.jsonl are append-only logs, one record per line.
 * - leads.jsonl is a log of lead snapshots; the last snapshot of a lead wins. Leads are also kept
 *   in memory (there is one server process), so updating a lead's recipients never re-reads the file.
 *
 * Writes of one file never interleave: each file has a queue. A disk problem (a folder that can't
 * be created or written) is logged by error code only and never thrown: leads stay readable from
 * memory for this process, and gaps and events are dropped. Nothing here blocks the visitor.
 * Records contain visitors' contact details: the folder is in .gitignore and never logged.
 */
export class FileStore implements LeadStore {
  readonly kind = 'file';

  private closed = false;
  private leads: Map<string, Lead> | null = null;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      await this.loadLeads();
    } catch (error) {
      log.error('storage_init_failed', { store: this.kind, code: errorCode(error) });
    }
  }

  async saveLead(lead: Lead): Promise<void> {
    this.assertOpen();
    const leads = await this.loadLeads();
    const copy = structuredClone(lead);
    leads.set(copy.id, copy);
    await this.append('leads.jsonl', [copy]);
  }

  async updateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<void> {
    if (!(await this.tryUpdateLeadRecipients(leadId, recipients))) {
      log.warn('lead_not_found', { store: this.kind, leadId });
    }
  }

  async tryUpdateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<boolean> {
    this.assertOpen();
    const lead = (await this.loadLeads()).get(leadId);
    if (!lead) return false;
    lead.recipients = structuredClone(recipients);
    await this.append('leads.jsonl', [lead]);
    return true;
  }

  async saveGap(gap: GapRecord): Promise<void> {
    this.assertOpen();
    await this.append('gaps.jsonl', [gap]);
  }

  async saveEvents(events: EventRecord[]): Promise<void> {
    this.assertOpen();
    if (events.length > 0) await this.append('events.jsonl', events);
  }

  async listLeads(range?: DateRange): Promise<Lead[]> {
    this.assertOpen();
    const leads = await this.loadLeads();
    return [...leads.values()]
      .filter((lead) => inRange(lead.createdAt, range))
      .map((lead) => structuredClone(lead));
  }

  async listGaps(range?: DateRange): Promise<GapRecord[]> {
    this.assertOpen();
    const gaps = await this.readLines<GapRecord>('gaps.jsonl');
    return gaps.filter((gap) => inRange(gap.createdAt, range));
  }

  async listEvents(range?: DateRange): Promise<EventRecord[]> {
    this.assertOpen();
    const events = await this.readLines<EventRecord>('events.jsonl');
    return events.filter((event) => inRange(event.at, range));
  }

  /** Leads whose createdAt can't be parsed are kept. */
  async deleteLeadsBefore(cutoff: Date): Promise<number> {
    this.assertOpen();
    const leads = await this.loadLeads();
    let deleted = 0;
    for (const [id, lead] of leads) {
      if (Date.parse(lead.createdAt) < cutoff.getTime()) {
        leads.delete(id);
        deleted += 1;
      }
    }
    if (deleted > 0) await this.rewriteLeads([...leads.values()]);
    return deleted;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.queues.values()]);
  }

  // ---------------------------------------------------------------- Files

  /** Loads the leads once: the last snapshot of each lead wins. */
  private loadLeads(): Promise<Map<string, Lead>> {
    if (this.leads) return Promise.resolve(this.leads);
    return this.enqueue('leads.jsonl', async () => {
      if (this.leads) return this.leads;
      const loaded = new Map<string, Lead>();
      for (const lead of await this.readLines<Lead>('leads.jsonl')) {
        if (lead && typeof lead.id === 'string') loaded.set(lead.id, lead);
      }
      this.leads = loaded;
      return loaded;
    });
  }

  private async rewriteLeads(leads: readonly Lead[]): Promise<void> {
    await this.enqueue('leads.jsonl', async () => {
      const path = join(this.dir, 'leads.jsonl');
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await writeFile(temp, leads.map((lead) => `${JSON.stringify(lead)}\n`).join(''), 'utf8');
        await rename(temp, path);
      } catch (error) {
        log.error('storage_write_failed', { store: this.kind, file: 'leads.jsonl', code: errorCode(error) });
      }
    });
  }

  /** Appends records, one JSON line each. Never throws: a disk problem is logged. */
  private append(file: string, records: readonly unknown[]): Promise<void> {
    const text = records.map((record) => `${JSON.stringify(record)}\n`).join('');
    return this.enqueue(file, async () => {
      try {
        await mkdir(this.dir, { recursive: true });
        await appendFile(join(this.dir, file), text, 'utf8');
      } catch (error) {
        log.error('storage_write_failed', { store: this.kind, file, code: errorCode(error) });
      }
    });
  }

  /** The records of a log file. A missing file is empty; corrupt lines are skipped (counted, never shown). */
  private async readLines<T>(file: string): Promise<T[]> {
    let text: string;
    try {
      text = await readFile(join(this.dir, file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('storage_read_failed', { store: this.kind, file, code: errorCode(error) });
      }
      return [];
    }
    const records: T[] = [];
    let corrupt = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as T);
      } catch {
        corrupt += 1;
      }
    }
    if (corrupt > 0) log.warn('storage_corrupt_lines', { store: this.kind, file, corrupt });
    return records;
  }

  /** Runs tasks for one file one after another. */
  private enqueue<T>(file: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(file) ?? Promise.resolve();
    const next = previous.then(task, task);
    // Keep the chain alive after a rejection; the caller still sees the error.
    this.queues.set(
      file,
      next.catch(() => undefined),
    );
    return next;
  }

  private assertOpen(): void {
    if (this.closed) throw new StoreClosedError();
  }
}
