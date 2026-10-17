import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import type { DateRange, EventRecord, GapRecord, Lead, LeadRecipient } from '../domain/types.js';
import { log } from '../lib/log.js';
import { errorCode, StoreClosedError } from './errors.js';
import { canonicalTime } from './range.js';
import type { LeadStore } from './types.js';

export interface MongoStoreOptions {
  /** How long to wait for a server before an operation fails (it then falls back to files). */
  serverSelectionTimeoutMs?: number;
}

/**
 * Leads, gaps and events in MongoDB (official driver), used when MONGODB_URI is set. It connects
 * on first use and reconnects after a failure. Every operation can reject: ResilientStore sends
 * the data to the files instead, so a database problem never reaches the visitor.
 *
 * Times are stored as ISO text (always the toISOString form), so range filters compare as text.
 */
export class MongoStore implements LeadStore {
  readonly kind = 'mongo';

  private client: MongoClient | null = null;
  private db: Promise<Db> | null = null;
  private closed = false;

  constructor(
    private readonly uri: string,
    private readonly dbName: string,
    private readonly options: MongoStoreOptions = {},
  ) {}

  /** Tries to connect now so a wrong URI shows up in the log at startup. Never throws. */
  async init(): Promise<void> {
    try {
      await this.connect();
      log.info('mongodb_connected', { db: this.dbName });
    } catch (error) {
      log.warn('mongodb_unavailable', {
        code: errorCode(error),
        note: 'saving to files until it is back',
      });
    }
  }

  async saveLead(lead: Lead): Promise<void> {
    await (
      await this.collection<Lead>('leads')
    ).replaceOne({ id: lead.id }, { ...lead }, { upsert: true });
  }

  async updateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<void> {
    if (!(await this.tryUpdateLeadRecipients(leadId, recipients))) {
      log.warn('lead_not_found', { store: this.kind, leadId });
    }
  }

  async tryUpdateLeadRecipients(leadId: string, recipients: LeadRecipient[]): Promise<boolean> {
    const result = await (
      await this.collection<Lead>('leads')
    ).updateOne({ id: leadId }, { $set: { recipients } });
    return result.matchedCount > 0;
  }

  async saveGap(gap: GapRecord): Promise<void> {
    await (await this.collection<GapRecord>('gaps')).insertOne({ ...gap });
  }

  async saveEvents(events: EventRecord[]): Promise<void> {
    if (events.length === 0) return;
    await (
      await this.collection<EventRecord>('events')
    ).insertMany(
      events.map((event) => ({ ...event })),
      { ordered: false },
    );
  }

  async listLeads(range?: DateRange): Promise<Lead[]> {
    return this.list<Lead>('leads', 'createdAt', range);
  }

  async listGaps(range?: DateRange): Promise<GapRecord[]> {
    return this.list<GapRecord>('gaps', 'createdAt', range);
  }

  async listEvents(range?: DateRange): Promise<EventRecord[]> {
    return this.list<EventRecord>('events', 'at', range);
  }

  async deleteLeadsBefore(cutoff: Date): Promise<number> {
    const result = await (
      await this.collection<Lead>('leads')
    ).deleteMany({ createdAt: { $lt: cutoff.toISOString() } });
    return result.deletedCount;
  }

  async close(): Promise<void> {
    this.closed = true;
    const client = this.client;
    this.client = null;
    this.db = null;
    await client?.close().catch(() => undefined);
  }

  // ---------------------------------------------------------------- Connection

  private connect(): Promise<Db> {
    if (this.closed) return Promise.reject(new StoreClosedError());
    this.db ??= this.open().catch((error: unknown) => {
      // Forget the failed attempt, so the next operation tries again.
      this.db = null;
      void this.client?.close().catch(() => undefined);
      this.client = null;
      throw error;
    });
    return this.db;
  }

  private async open(): Promise<Db> {
    const timeout = this.options.serverSelectionTimeoutMs ?? 5_000;
    const client = new MongoClient(this.uri, {
      serverSelectionTimeoutMS: timeout,
      connectTimeoutMS: timeout,
      socketTimeoutMS: 20_000,
      maxPoolSize: 5,
      appName: 'adn-matcher',
    });
    this.client = client;
    await client.connect();
    const db = client.db(this.dbName);
    await Promise.all([
      db
        .collection('events')
        .createIndexes([
          { key: { at: 1 } },
          { key: { sessionId: 1 } },
          { key: { type: 1, at: 1 } },
        ]),
      db
        .collection('gaps')
        .createIndexes([
          { key: { state: 1, countyFips: 1, category: 1 } },
          { key: { createdAt: 1 } },
        ]),
      db
        .collection('leads')
        .createIndexes([
          { key: { id: 1 }, unique: true },
          { key: { createdAt: 1 } },
          { key: { memberIds: 1 } },
        ]),
    ]);
    return db;
  }

  private async collection<T extends Document>(name: string): Promise<Collection<T>> {
    return (await this.connect()).collection<T>(name);
  }

  private async list<T extends Document>(
    name: string,
    timeField: string,
    range: DateRange = {},
  ): Promise<T[]> {
    const bounds: Document = {};
    if (range.from) bounds.$gte = canonicalTime(range.from.toISOString());
    if (range.to) bounds.$lte = canonicalTime(range.to.toISOString());
    const filter: Document = Object.keys(bounds).length > 0 ? { [timeField]: bounds } : {};
    const collection = await this.collection<Document>(name);
    // _id is the database's own key: never part of a record.
    return (await collection.find(filter, { projection: { _id: 0 } }).toArray()) as unknown as T[];
  }
}
