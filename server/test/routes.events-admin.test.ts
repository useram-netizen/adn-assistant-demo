import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { EventRecord } from '../src/domain/types.js';
import { csvCell, gapsCsv } from '../src/routes/admin.js';
import { testApp, testDeps } from './helpers.js';

const TOKEN = 'a-long-admin-token-0123456789';
const now = () => new Date().toISOString();

const batch = (events: unknown[], overrides: Record<string, unknown> = {}) => ({
  sessionId: randomUUID(),
  site: 'divorceamicably',
  events,
  ...overrides,
});

describe('POST /api/events', () => {
  it('stores a batch of usage events (option values and counts only) and answers 204', async () => {
    const deps = await testDeps();
    const app = await testApp({}, { deps });
    const res = await request(app)
      .post('/api/events')
      .send(
        batch([
          { type: 'session_started', data: { mode: 'inline' }, at: now() },
          { type: 'step_viewed', data: { step: 'welcome' }, at: now() },
          { type: 'answer', data: { step: 'location', value: 'GA' }, at: now() },
          { type: 'branch', data: { branch: 'uk' }, at: now() },
          {
            type: 'results_shown',
            data: {
              platinum: 6,
              gold: 10,
              silver: 19,
              total: 35,
              category: 'attorney',
              state: 'GA',
            },
            at: now(),
          },
          {
            type: 'no_match',
            data: { category: 'attorney', state: 'WY', countyFips: '56039' },
            at: now(),
          },
          { type: 'pros_selected', data: { count: 2 }, at: now() },
          { type: 'link_clicked', data: { link: 'join' }, at: now() },
          { type: 'safety_shown', data: { trigger: 'keyword' }, at: now() },
        ]),
      );
    expect(res.status).toBe(204);
    const saved = await deps.store.listEvents();
    expect(saved).toHaveLength(9);
    expect(saved[0]).toMatchObject({
      site: 'divorceamicably',
      source: 'client',
      type: 'session_started',
    });
    expect(Date.parse(saved[0]!.receivedAt)).not.toBeNaN();
  });

  it('refuses anything that is not an option value or a count (no text a visitor typed)', async () => {
    const app = await testApp();
    const send = (event: unknown) =>
      request(app)
        .post('/api/events')
        .send(batch([event]));
    for (const event of [
      {
        type: 'answer',
        data: { step: 'situation', value: 'My husband and I decided to split' },
        at: now(),
      },
      { type: 'answer', data: { step: 'x', value: 'jane@example.com' }, at: now() },
      { type: 'answer', data: { step: 'x', value: 'a'.repeat(65) }, at: now() },
      { type: 'answer', data: { step: 'x', value: 'GA', text: 'extra key' }, at: now() },
      { type: 'step_viewed', data: { step: '' }, at: now() },
      { type: 'branch', data: { branch: 'somewhere' }, at: now() },
      { type: 'pros_selected', data: { count: 6 }, at: now() },
      {
        type: 'results_shown',
        data: { platinum: -1, gold: 0, silver: 0, total: 0, category: 'a', state: 'GA' },
        at: now(),
      },
      { type: 'ai_call', data: { kind: 'interpret', ms: 1, ok: true, tokens: 1 }, at: now() }, // server-only
      { type: 'lead_submitted', data: { count: 1, category: 'attorney' }, at: now() }, // server-only
      { type: 'nope', data: {}, at: now() },
      { type: 'step_viewed', data: { step: 'welcome' }, at: 'yesterday' },
      { type: 'step_viewed', data: { step: 'welcome' } },
    ]) {
      const res = await send(event);
      expect(res.status, JSON.stringify(event)).toBe(400);
    }
  });

  it('rejects a whole batch if any event is bad, and stores nothing', async () => {
    const deps = await testDeps();
    const res = await request(await testApp({}, { deps }))
      .post('/api/events')
      .send(
        batch([
          { type: 'step_viewed', data: { step: 'welcome' }, at: now() },
          { type: 'nope', data: {}, at: now() },
        ]),
      );
    expect(res.status).toBe(400);
    expect(await deps.store.listEvents()).toEqual([]);
  });

  it('allows 1 to 50 events', async () => {
    const app = await testApp();
    const event = { type: 'step_viewed', data: { step: 'welcome' }, at: now() };
    expect((await request(app).post('/api/events').send(batch([]))).status).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/events')
          .send(batch(Array(50).fill(event)))
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .post('/api/events')
          .send(batch(Array(51).fill(event)))
      ).status,
    ).toBe(400);
  });

  it('needs a session id that is a UUID', async () => {
    const res = await request(await testApp())
      .post('/api/events')
      .send(
        batch([{ type: 'step_viewed', data: { step: 'welcome' }, at: now() }], {
          sessionId: 'abc',
        }),
      );
    expect(res.status).toBe(400);
  });

  it('dates an event by the server when the visitor’s clock is far off', async () => {
    const deps = await testDeps();
    await request(await testApp({}, { deps }))
      .post('/api/events')
      .send(
        batch([{ type: 'step_viewed', data: { step: 'welcome' }, at: '2001-01-01T00:00:00.000Z' }]),
      )
      .expect(204);
    const [saved] = await deps.store.listEvents();
    expect(Math.abs(Date.parse(saved!.at) - Date.now())).toBeLessThan(60_000);
  });

  it('still answers 204 when the store fails (tracking never gets in the way)', async () => {
    const deps = await testDeps();
    deps.store.failing.add('saveEvents');
    const res = await request(await testApp({}, { deps }))
      .post('/api/events')
      .send(batch([{ type: 'step_viewed', data: { step: 'welcome' }, at: now() }]));
    expect(res.status).toBe(204);
  });
});

describe('admin routes', () => {
  const eventAt = (
    sessionId: string,
    type: string,
    data: object,
    at = '2026-10-17T10:00:00.000Z',
  ) =>
    ({
      sessionId,
      site: 'divorceamicably',
      type,
      data,
      at,
      receivedAt: at,
      source: 'client',
    }) as EventRecord;

  async function adminApp() {
    const deps = await testDeps();
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    await deps.store.saveEvents([
      eventAt(a, 'session_started', { mode: 'inline' }),
      eventAt(b, 'session_started', { mode: 'bubble' }),
      eventAt(c, 'session_started', { mode: 'inline' }, '2026-09-01T10:00:00.000Z'),
      eventAt(a, 'results_shown', {
        platinum: 1,
        gold: 0,
        silver: 0,
        total: 1,
        category: 'attorney',
        state: 'GA',
      }),
      eventAt(b, 'no_match', { category: 'attorney', state: 'WY', countyFips: '56039' }),
      eventAt(a, 'ai_call', { kind: 'interpret', ms: 5, ok: true, tokens: 9 }),
      eventAt(a, 'ai_call', { kind: 'county', ms: 5, ok: false, tokens: 0 }),
    ]);
    const [first, second] = deps.directory.match(
      { state: 'GA', countyFips: '13121', category: 'attorney', subcategory: null },
      's',
    );
    for (const [id, memberIds] of [
      ['l1', [first!.id, second!.id]],
      ['l2', [first!.id]],
    ] as const) {
      await deps.store.saveLead({
        id,
        kind: 'pros',
        createdAt: '2026-10-17T11:00:00.000Z',
        sessionId: a,
        site: 'x',
        reason: null,
        state: 'GA',
        countyFips: '13121',
        county: 'Fulton County',
        category: 'attorney',
        subcategory: null,
        stage: null,
        memberIds: [...memberIds],
        contact: {
          firstName: 'J',
          lastName: 'D',
          email: 'j@example.org',
          phone: null,
          preferredContact: 'email',
        },
        message: 'm',
        recipients: [],
      });
    }
    await deps.store.saveLead({
      id: 'l3',
      kind: 'tracy',
      createdAt: '2026-10-17T11:00:00.000Z',
      sessionId: b,
      site: 'x',
      reason: 'no_match',
      state: 'WY',
      countyFips: '56039',
      county: 'Teton County',
      category: 'attorney',
      subcategory: null,
      stage: null,
      memberIds: [],
      contact: {
        firstName: 'J',
        lastName: 'D',
        email: 'j@example.org',
        phone: null,
        preferredContact: 'email',
      },
      message: 'm',
      recipients: [],
    });
    for (const county of ['Teton County', 'Teton County', 'Other County']) {
      await deps.store.saveGap({
        createdAt: '2026-10-17T10:00:00.000Z',
        site: 'x',
        state: 'WY',
        countyFips: county === 'Teton County' ? '56039' : '56001',
        county,
        category: 'attorney',
        subcategory: null,
      });
    }
    return { app: await testApp({ ADMIN_TOKEN: TOKEN }, { deps }), first: first!, second: second! };
  }

  const auth = { Authorization: `Bearer ${TOKEN}` };

  it('is off (404) when ADMIN_TOKEN is not set', async () => {
    const app = await testApp();
    for (const path of ['/api/admin/stats', '/api/admin/gaps.csv']) {
      const res = await request(app).get(path).set(auth);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'admin_disabled' });
    }
  });

  it('refuses a missing or wrong token', async () => {
    const { app } = await adminApp();
    for (const header of [undefined, 'Bearer nope', `Bearer ${TOKEN}x`, 'Basic abc', TOKEN]) {
      const req = request(app).get('/api/admin/stats');
      const res = await (header ? req.set('Authorization', header) : req);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
  });

  it('reports sessions, leads, match rate, AI calls and leads per member', async () => {
    const { app, first, second } = await adminApp();
    const res = await request(app).get('/api/admin/stats').set(auth).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      sessions: 3,
      sessionsReachingResults: 2,
      leads: 2,
      tracyRequests: 1,
      matchRate: 0.5,
      aiCalls: 2,
      aiFailures: 1,
    });
    expect((res.body as { leadsPerMember: unknown[] }).leadsPerMember).toEqual([
      { memberId: first.id, name: first.name, count: 2 },
      { memberId: second.id, name: second.name, count: 1 },
    ]);
  });

  it('limits the stats to a date range', async () => {
    const { app } = await adminApp();
    const res = await request(app)
      .get('/api/admin/stats?from=2026-10-01&to=2026-10-31')
      .set(auth)
      .expect(200);
    expect(res.body).toMatchObject({ from: '2026-10-01', to: '2026-10-31', sessions: 2 });
    expect((await request(app).get('/api/admin/stats?from=yesterday').set(auth)).status).toBe(400);
  });

  it('exports the no-match searches grouped by state, county and category, most frequent first', async () => {
    const { app } = await adminApp();
    const res = await request(app).get('/api/admin/gaps.csv').set(auth).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toBe(
      [
        'state,county_fips,county,category,subcategory,count',
        'WY,56039,Teton County,attorney,,2',
        'WY,56001,Other County,attorney,,1',
        '',
      ].join('\n'),
    );
  });
});

describe('CSV output', () => {
  it('quotes cells that need it', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(3)).toBe('3');
  });

  it('keeps a spreadsheet from running a cell as a formula', () => {
    for (const cell of ['=HYPERLINK("http://x")', '+1', '-1', '@SUM(A1)']) {
      expect(csvCell(cell).replace(/^"/, '')).toMatch(/^'/);
    }
  });

  it('is only a header when there are no gaps', () => {
    expect(gapsCsv([])).toBe('state,county_fips,county,category,subcategory,count\n');
  });
});
