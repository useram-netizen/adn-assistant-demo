import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventRecord, GapRecord, Lead } from '../src/domain/types.js';
import { createEventSink } from '../src/events/sink.js';
import { startLeadRetention } from '../src/jobs/retention.js';
import { createStore, FileStore, MongoStore, ResilientStore } from '../src/storage/index.js';
import { MemoryStore } from '../src/storage/memoryStore.js';
import { testConfig } from './helpers.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adn-store-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const lead = (id: string, createdAt = '2026-10-17T10:00:00.000Z'): Lead => ({
  id,
  kind: 'pros',
  createdAt,
  sessionId: 's',
  site: 'divorceamicably',
  reason: null,
  state: 'GA',
  countyFips: '13121',
  county: 'Fulton County',
  category: 'attorney',
  subcategory: null,
  stage: 'ready',
  memberIds: ['m_1'],
  contact: {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.org',
    phone: null,
    preferredContact: 'email',
  },
  message: 'Hello',
  recipients: [
    {
      kind: 'professional',
      memberId: 'm_1',
      to: 'p@example.com',
      status: 'pending',
      attempts: 0,
      updatedAt: createdAt,
    },
  ],
});

const gap = (county = 'Teton County', createdAt = '2026-10-17T10:00:00.000Z'): GapRecord => ({
  createdAt,
  site: 'divorceamicably',
  state: 'WY',
  countyFips: '56039',
  county,
  category: 'attorney',
  subcategory: null,
});

const event = (type: string, at = '2026-10-17T10:00:00.000Z'): EventRecord =>
  ({
    sessionId: 's',
    site: 'x',
    type,
    data: { step: 'welcome' },
    at,
    receivedAt: at,
    source: 'client',
  }) as EventRecord;

describe('FileStore (used when MONGODB_URI is not set)', () => {
  it('saves leads, gaps and events and reads them back, even from a new instance', async () => {
    const store = new FileStore(dir);
    await store.init();
    await store.saveLead(lead('a'));
    await store.saveGap(gap());
    await store.saveEvents([event('step_viewed'), event('answer')]);
    await store.close();

    const again = new FileStore(dir);
    await again.init();
    expect((await again.listLeads()).map((l) => l.id)).toEqual(['a']);
    expect(await again.listGaps()).toEqual([gap()]);
    expect((await again.listEvents()).map((e) => e.type)).toEqual(['step_viewed', 'answer']);
  });

  it('creates its folder when it is missing', async () => {
    const store = new FileStore(join(dir, 'a', 'b'));
    await store.init();
    await store.saveGap(gap());
    expect(await store.listGaps()).toHaveLength(1);
  });

  it('keeps recipient updates (the last snapshot of a lead wins), also after a restart', async () => {
    const store = new FileStore(dir);
    await store.saveLead(lead('a'));
    const [recipient] = lead('a').recipients;
    await store.updateLeadRecipients('a', [{ ...recipient!, status: 'sent', attempts: 1 }]);
    expect((await store.listLeads())[0]?.recipients[0]?.status).toBe('sent');
    const again = new FileStore(dir);
    expect((await again.listLeads())[0]?.recipients[0]).toMatchObject({
      status: 'sent',
      attempts: 1,
    });
    expect(await again.listLeads()).toHaveLength(1);
  });

  it('does not lose or mix up lines when many writes arrive at once', async () => {
    const store = new FileStore(dir);
    await Promise.all(
      Array.from({ length: 200 }, (_, index) => store.saveEvents([event(`e${index}`)])),
    );
    const events = await store.listEvents();
    expect(events).toHaveLength(200);
    expect(new Set(events.map((e) => e.type)).size).toBe(200);
  });

  it('skips corrupt lines instead of failing', async () => {
    await writeFile(
      join(dir, 'gaps.jsonl'),
      `${JSON.stringify(gap())}\n{not json\n\n${JSON.stringify(gap('Other County'))}\n`,
    );
    const store = new FileStore(dir);
    expect((await store.listGaps()).map((g) => g.county)).toEqual(['Teton County', 'Other County']);
  });

  it('filters by date range (inclusive)', async () => {
    const store = new FileStore(dir);
    await store.saveGap(gap('a', '2026-10-01T00:00:00.000Z'));
    await store.saveGap(gap('b', '2026-10-15T12:00:00.000Z'));
    await store.saveGap(gap('c', '2026-10-30T00:00:00.000Z'));
    const range = { from: new Date('2026-10-10T00:00:00Z'), to: new Date('2026-10-20T00:00:00Z') };
    expect((await store.listGaps(range)).map((g) => g.county)).toEqual(['b']);
  });

  it('deletes leads older than a date (retention)', async () => {
    const store = new FileStore(dir);
    await store.saveLead(lead('old', '2026-01-01T00:00:00.000Z'));
    await store.saveLead(lead('new', '2026-10-10T00:00:00.000Z'));
    expect(await store.deleteLeadsBefore(new Date('2026-06-01T00:00:00Z'))).toBe(1);
    expect((await new FileStore(dir).listLeads()).map((l) => l.id)).toEqual(['new']);
  });

  it('never throws when the folder cannot be written: leads stay in memory, gaps and events are dropped', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => void errors.push(String(line)));
    // A file where the folder should be: it can never be created.
    const blocked = join(dir, 'blocked');
    await writeFile(blocked, 'x');
    const store = new FileStore(join(blocked, 'data'));
    await expect(store.init()).resolves.toBeUndefined();
    await expect(store.saveLead(lead('a'))).resolves.toBeUndefined();
    await expect(store.saveGap(gap())).resolves.toBeUndefined();
    await expect(store.saveEvents([event('step_viewed')])).resolves.toBeUndefined();
    expect((await store.listLeads()).map((l) => l.id)).toEqual(['a']);
    expect(errors.join('\n')).toContain('storage_write_failed');
    // The log names the error code only, never the data.
    expect(errors.join('\n')).not.toContain('jane@example.org');
  });

  it('writes files only this user can read, if the system allows it', async () => {
    const store = new FileStore(join(dir, 'data'));
    await store.init();
    await store.saveLead(lead('a'));
    await store.saveGap(gap());
    await store.saveEvents([event('step_viewed')]);
    const text = await readFile(join(dir, 'data', 'leads.jsonl'), 'utf8');
    expect(text.trim().split('\n')).toHaveLength(1);
    if (process.platform !== 'win32') {
      expect((await stat(join(dir, 'data'))).mode & 0o777).toBe(0o700);
      for (const file of ['leads.jsonl', 'gaps.jsonl', 'events.jsonl']) {
        expect((await stat(join(dir, 'data', file))).mode & 0o777, file).toBe(0o600);
      }
    }
  });

  it('makes a folder and files that were already there private too', async () => {
    if (process.platform === 'win32') return;
    await writeFile(join(dir, 'leads.jsonl'), '');
    await chmod(join(dir, 'leads.jsonl'), 0o644);
    await chmod(dir, 0o755);
    await new FileStore(dir).init();
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'leads.jsonl'))).mode & 0o777).toBe(0o600);
  });

  it('stops adding to the events and gaps logs at their size limit, but never to the leads', async () => {
    const warnings: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => void warnings.push(String(line)));
    const store = new FileStore(dir, { 'events.jsonl': 600, 'gaps.jsonl': 400 });
    await store.init();
    for (let i = 0; i < 20; i += 1) await store.saveEvents([event('step_viewed')]);
    for (let i = 0; i < 20; i += 1) await store.saveGap(gap());
    for (let i = 0; i < 20; i += 1) await store.saveLead(lead(`lead-${i}`));

    expect((await stat(join(dir, 'events.jsonl'))).size).toBeLessThanOrEqual(600);
    expect((await stat(join(dir, 'gaps.jsonl'))).size).toBeLessThanOrEqual(400);
    expect((await store.listEvents()).length).toBeGreaterThan(0);
    expect((await store.listEvents()).length).toBeLessThan(20);
    expect(await store.listLeads()).toHaveLength(20);
    // Said once, not once per dropped record.
    const full = warnings.filter((line) => line.includes('storage_file_full'));
    expect(full.length).toBe(2);

    // A new process counts what is already in the file.
    const again = new FileStore(dir, { 'events.jsonl': 600 });
    await again.init();
    const before = (await again.listEvents()).length;
    await again.saveEvents([event('step_viewed')]);
    expect((await again.listEvents()).length).toBe(before);
  });
});

describe('createStore', () => {
  it('uses JSON files in STORAGE_DIR', () => {
    const store = createStore(testConfig({ STORAGE_DIR: dir }));
    expect(store.kind).toBe('file');
  });

  it('uses MongoDB with the files as a safety net when MONGODB_URI is set', () => {
    const store = createStore(
      testConfig({ STORAGE_DIR: dir, MONGODB_URI: 'mongodb://127.0.0.1:1/adn' }),
    );
    expect(store.kind).toBe('mongo');
    expect(store).toBeInstanceOf(ResilientStore);
  });
});

describe('the event sink', () => {
  it('writes server events in a batch, with a time and the source "server"', async () => {
    const store = new MemoryStore();
    const sink = createEventSink(store, {
      flushMs: 10_000,
      now: () => new Date('2026-10-17T10:00:00Z'),
    });
    sink.record({
      sessionId: 's',
      site: 'x',
      type: 'ai_call',
      data: { kind: 'interpret', ms: 5, ok: true, tokens: 1 },
    });
    sink.record({
      sessionId: 's',
      site: 'x',
      type: 'email_failed',
      data: { kind: 'professional', attempts: 4 },
    });
    expect(await store.listEvents()).toHaveLength(0);
    await sink.flush();
    const saved = await store.listEvents();
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      source: 'server',
      at: '2026-10-17T10:00:00.000Z',
      type: 'ai_call',
    });
  });

  it('logs and carries on when the store fails', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => void errors.push(String(line)));
    const store = new MemoryStore();
    store.failing.add('saveEvents');
    const sink = createEventSink(store);
    sink.record({
      sessionId: 's',
      site: 'x',
      type: 'ai_call',
      data: { kind: 'interpret', ms: 1, ok: true, tokens: 1 },
    });
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(errors.join('\n')).toContain('events_save_failed');
  });
});

describe('lead retention (LEAD_RETENTION_DAYS, OPEN)', () => {
  it('does nothing when no number of days is set', async () => {
    const store = new MemoryStore();
    await store.saveLead(lead('old', '2020-01-01T00:00:00.000Z'));
    const stop = startLeadRetention(store, undefined);
    stop();
    expect(await store.listLeads()).toHaveLength(1);
  });

  it('deletes leads older than the number of days', async () => {
    const store = new MemoryStore();
    await store.saveLead(lead('old', '2026-01-01T00:00:00.000Z'));
    await store.saveLead(lead('recent', '2026-10-10T00:00:00.000Z'));
    const stop = startLeadRetention(store, 30, () => new Date('2026-10-17T00:00:00Z'));
    await vi.waitFor(async () =>
      expect((await store.listLeads()).map((l) => l.id)).toEqual(['recent']),
    );
    stop();
  });
});

describe('ResilientStore and MongoStore (MONGODB_URI set)', () => {
  it('writes to the database when it works, and reads from both', async () => {
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    const store = new ResilientStore(primary, fallback);
    await store.saveLead(lead('a'));
    await store.saveGap(gap());
    expect(await primary.listLeads()).toHaveLength(1);
    expect(await fallback.listLeads()).toHaveLength(0);
    expect(await store.listLeads()).toHaveLength(1);
    expect(await store.listGaps()).toHaveLength(1);
  });

  it('falls back to the files when the database fails, and logs which operation and why', async () => {
    const warnings: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => void warnings.push(String(line)));
    const primary = new MemoryStore();
    primary.failing.add('saveLead').add('saveGap').add('saveEvents');
    const fallback = new MemoryStore();
    const store = new ResilientStore(primary, fallback);
    await store.saveLead(lead('a'));
    await store.saveGap(gap());
    await store.saveEvents([event('answer')]);
    expect(await fallback.listLeads()).toHaveLength(1);
    expect(await fallback.listGaps()).toHaveLength(1);
    expect(await fallback.listEvents()).toHaveLength(1);
    expect(warnings.join('\n')).toContain('storage_fallback');
    expect(warnings.join('\n')).toContain('saveLead');
    expect(warnings.join('\n')).not.toContain('jane@example.org');
  });

  it('still shows data written during an outage, once the database is back', async () => {
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    const store = new ResilientStore(primary, fallback);
    primary.failing.add('saveLead');
    await store.saveLead(lead('during-outage'));
    primary.failing.clear();
    await store.saveLead(lead('after'));
    expect((await store.listLeads()).map((l) => l.id).sort()).toEqual(['after', 'during-outage']);
  });

  it('updates a lead where it is: in the database, or in the files if it was saved there', async () => {
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    const store = new ResilientStore(primary, fallback);
    await primary.saveLead(lead('in-db'));
    await fallback.saveLead(lead('in-files'));
    const sent = [{ ...lead('x').recipients[0]!, status: 'sent' as const, attempts: 1 }];
    await store.updateLeadRecipients('in-db', sent);
    await store.updateLeadRecipients('in-files', sent);
    expect((await primary.listLeads())[0]?.recipients[0]?.status).toBe('sent');
    expect((await fallback.listLeads())[0]?.recipients[0]?.status).toBe('sent');
  });

  it('reads what it can when one store cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    await fallback.saveGap(gap());
    primary.failing.add('listGaps');
    expect(await new ResilientStore(primary, fallback).listGaps()).toHaveLength(1);
  });

  it('MongoStore: with no database reachable, init does not throw and operations fail fast (so they fall back)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mongo = new MongoStore('mongodb://127.0.0.1:1/adn', 'adn_test', {
      serverSelectionTimeoutMs: 300,
    });
    await expect(mongo.init()).resolves.toBeUndefined();
    const started = Date.now();
    await expect(mongo.saveGap(gap())).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(3_000);
    await mongo.close();
    const files = new FileStore(dir);
    const resilient = new ResilientStore(
      new MongoStore('mongodb://127.0.0.1:1/adn', 'adn_test', { serverSelectionTimeoutMs: 300 }),
      files,
    );
    await resilient.init();
    await resilient.saveLead(lead('safe'));
    expect((await files.listLeads()).map((l) => l.id)).toEqual(['safe']);
    await resilient.close();
  });
});
