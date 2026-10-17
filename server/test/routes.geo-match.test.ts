import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp, testDeps } from './helpers.js';

const search = (overrides: Record<string, unknown> = {}) => ({
  sessionId: randomUUID(),
  site: 'divorceamicably',
  state: 'GA',
  countyFips: '13121',
  category: 'attorney',
  ...overrides,
});

describe('GET /api/states', () => {
  it('lists the 50 states and DC by name', async () => {
    const res = await request(await testApp())
      .get('/api/states')
      .expect(200);
    const { states } = res.body as { states: Array<{ code: string; name: string }> };
    expect(states).toHaveLength(51);
    expect(states[0]).toEqual({ code: 'AL', name: 'Alabama' });
    expect(states.find((state) => state.code === 'DC')?.name).toBe('District of Columbia');
    expect(states.map((state) => state.name)).toEqual([...states.map((s) => s.name)].sort());
  });
});

describe('GET /api/counties', () => {
  it('lists a state’s counties by name', async () => {
    const res = await request(await testApp())
      .get('/api/counties?state=GA')
      .expect(200);
    const body = res.body as { state: string; counties: Array<{ fips: string; name: string }> };
    expect(body.state).toBe('GA');
    expect(body.counties).toHaveLength(159);
    expect(body.counties).toContainEqual({ fips: '13121', name: 'Fulton County' });
  });

  it('accepts lower-case codes', async () => {
    const res = await request(await testApp())
      .get('/api/counties?state=tx')
      .expect(200);
    expect((res.body as { counties: unknown[] }).counties).toHaveLength(254);
  });

  it.each(['', '?state=', '?state=ZZ', '?state=Georgia', '?state[]=GA'])(
    'rejects %j',
    async (query) => {
      const res = await request(await testApp())
        .get(`/api/counties${query}`)
        .expect(400);
      expect(res.body).toEqual({ error: 'validation_failed', fields: ['state'] });
    },
  );
});

describe('POST /api/match', () => {
  it('returns the matching professionals, Platinum first, with the counts', async () => {
    const res = await request(await testApp())
      .post('/api/match')
      .send(search())
      .expect(200);
    const body = res.body as {
      results: Array<{ tier: string; name: string; email?: string; id: string }>;
      total: number;
      noMatch: boolean;
      counts: Record<string, number>;
    };
    expect(body.total).toBe(35);
    expect(body.noMatch).toBe(false);
    expect(body.counts).toEqual({ platinum: 6, gold: 10, silver: 19 });
    expect(body.results.slice(0, 6).every((card) => card.tier === 'platinum')).toBe(true);
    // The professional's email stays on the server (SHOW_PRO_CONTACT=false).
    expect(body.results.every((card) => card.email === undefined)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/@/);
  });

  it('shows the email only when SHOW_PRO_CONTACT is on', async () => {
    const res = await request(await testApp({ SHOW_PRO_CONTACT: 'true' }))
      .post('/api/match')
      .send(search())
      .expect(200);
    expect((res.body as { results: Array<{ email?: string }> }).results[0]?.email).toMatch(/@/);
  });

  it('keeps the order for one session and changes it for another', async () => {
    const app = await testApp();
    const ids = async (sessionId: string) =>
      (
        (await request(app).post('/api/match').send(search({ sessionId }))).body as {
          results: Array<{ id: string }>;
        }
      ).results.map((card) => card.id);
    const session = randomUUID();
    expect(await ids(session)).toEqual(await ids(session));
    expect(await ids(session)).not.toEqual(await ids(randomUUID()));
  });

  it('filters by subtype, and "any" means the whole category', async () => {
    const app = await testApp();
    const total = async (subcategory: unknown) =>
      (
        (
          await request(app)
            .post('/api/match')
            .send(search({ category: 'financial', subcategory }))
        ).body as { total: number }
      ).total;
    expect(await total(null)).toBe(18);
    expect(await total('any')).toBe(18);
    expect(await total('cdfa')).toBeLessThan(18);
    expect(await total('cdfa')).toBeGreaterThan(0);
  });

  it('answers a search with nobody as noMatch, and saves a gap', async () => {
    const deps = await testDeps();
    const app = await testApp({}, { deps });
    const res = await request(app)
      .post('/api/match')
      .send(search({ state: 'WY', countyFips: '56039', site: 'amicabledivorce' }))
      .expect(200);
    expect(res.body).toEqual({
      results: [],
      total: 0,
      noMatch: true,
      counts: { platinum: 0, gold: 0, silver: 0 },
    });
    const gaps = await deps.store.listGaps();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      site: 'amicabledivorce',
      state: 'WY',
      countyFips: '56039',
      county: 'Teton County',
      category: 'attorney',
      subcategory: null,
    });
    expect(Date.parse(gaps[0]!.createdAt)).not.toBeNaN();
  });

  it('still answers when the gap cannot be saved', async () => {
    const deps = await testDeps();
    deps.store.failing.add('saveGap');
    const res = await request(await testApp({}, { deps }))
      .post('/api/match')
      .send(search({ state: 'WY', countyFips: '56039' }))
      .expect(200);
    expect((res.body as { noMatch: boolean }).noMatch).toBe(true);
  });

  it('does not save a gap when there are matches', async () => {
    const deps = await testDeps();
    await request(await testApp({}, { deps }))
      .post('/api/match')
      .send(search())
      .expect(200);
    expect(await deps.store.listGaps()).toEqual([]);
  });

  it('falls back to "unknown" for a site key that is not a plain word', async () => {
    const deps = await testDeps();
    await request(await testApp({}, { deps }))
      .post('/api/match')
      .send(search({ state: 'WY', countyFips: '56039', site: '<script>' }))
      .expect(200);
    expect((await deps.store.listGaps())[0]?.site).toBe('unknown');
  });

  it.each([
    ['a missing session id', { sessionId: undefined }, 'sessionId'],
    ['a session id that is not a UUID', { sessionId: 'abc' }, 'sessionId'],
    ['an unknown state', { state: 'ZZ' }, 'state'],
    ['a county that is not in the state', { countyFips: '17031' }, 'countyFips'],
    ['a county that is not a FIPS code', { countyFips: 'Fulton' }, 'countyFips'],
    ['an unknown category', { category: 'astrologer' }, 'category'],
    ['a subtype of another category', { category: 'mediator', subcategory: 'cdfa' }, 'subcategory'],
  ])('rejects %s', async (_name, overrides, field) => {
    const res = await request(await testApp())
      .post('/api/match')
      .send(search(overrides))
      .expect(400);
    expect(res.body).toMatchObject({ error: 'validation_failed' });
    expect((res.body as { fields: string[] }).fields).toContain(field);
  });

  it('is limited to 30 searches a minute per address', async () => {
    const deps = await testDeps({ rateLimitEnabled: true });
    const app = await testApp({}, { deps });
    let last = 0;
    for (let index = 0; index < 31; index += 1) {
      last = (await request(app).post('/api/match').send(search())).status;
    }
    expect(last).toBe(429);
  });
});
