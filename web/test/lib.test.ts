import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, parsePublicConfig } from '../src/lib/api';
import { readEmbedContext } from '../src/lib/embedContext';
import { createTracker } from '../src/lib/events';
import { errorCode, withErrorReports } from '../src/lib/reporting';
import { fakeApi } from './support';

describe('readEmbedContext', () => {
  const topWindow = { self: 1, top: 1 } as unknown as Window;
  const framedWindow = { self: 1, top: 2 } as unknown as Window;

  it('reads the site and mode passed by embed.js', () => {
    expect(readEmbedContext('?site=divorceamicably&mode=inline', framedWindow)).toEqual({
      site: 'divorceamicably',
      mode: 'inline',
      framed: true,
    });
    expect(readEmbedContext('?site=amicabledivorce&mode=bubble', framedWindow).mode).toBe('bubble');
  });

  it('treats the fallback iframe and direct visits as standalone', () => {
    expect(readEmbedContext('?site=divorceamicably', framedWindow).mode).toBe('standalone');
    expect(readEmbedContext('', topWindow)).toEqual({
      site: 'unknown',
      mode: 'standalone',
      framed: false,
    });
  });

  it('only accepts simple site keys', () => {
    expect(readEmbedContext('?site=DivorceAmicably', topWindow).site).toBe('divorceamicably');
    expect(readEmbedContext('?site=%3Cscript%3E', topWindow).site).toBe('unknown');
    expect(readEmbedContext(`?site=${'a'.repeat(41)}`, topWindow).site).toBe('unknown');
  });

  it('counts as framed when window.top cannot be read', () => {
    const crossOrigin = {
      self: 1,
      get top(): never {
        throw new Error('SecurityError');
      },
    } as unknown as Window;
    expect(readEmbedContext('', crossOrigin).framed).toBe(true);
  });
});

describe('parsePublicConfig', () => {
  it('keeps http(s) links and turns anything else into null', () => {
    const config = parsePublicConfig({
      links: {
        join: 'https://amicabledivorce.net/join',
        ukSite: 'https://amicabledivorcenetwork.co.uk',
        privacy: 'javascript:alert(1)',
        articles: 'not a url',
        podcast: 42,
      },
    });
    expect(config.links).toEqual({
      join: 'https://amicabledivorce.net/join',
      ukSite: 'https://amicabledivorcenetwork.co.uk/',
      articles: null,
      podcast: null,
      booking: null,
      privacy: null,
    });
  });

  it('copes with a response of the wrong shape', () => {
    expect(parsePublicConfig(null).links.join).toBeNull();
    expect(parsePublicConfig({ links: 'nope' }).links.privacy).toBeNull();
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const dropped = () => Promise.reject(new TypeError('Failed to fetch'));

describe('the requests when the connection drops', () => {
  it('tries a request that changes nothing again, and gets there', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(dropped)
      .mockImplementationOnce(dropped)
      .mockResolvedValue(json({ states: [{ code: 'GA', name: 'Georgia' }] }));
    const api = createApi(fetch, { retryDelaysMs: [0, 0] });
    await expect(api.states()).resolves.toEqual([{ code: 'GA', name: 'Georgia' }]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('also after a busy server (503), but not after a refusal (400) or a timeout', async () => {
    const busy = vi
      .fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValue(json({ results: [] }));
    await createApi(busy, { retryDelaysMs: [0, 0] }).match({
      sessionId: 's',
      site: 'x',
      state: 'GA',
      countyFips: '13121',
      category: 'attorney',
    });
    expect(busy).toHaveBeenCalledTimes(2);

    const refused = vi.fn().mockResolvedValue(json({ error: 'validation_failed' }, 400));
    await expect(
      createApi(refused, { retryDelaysMs: [0, 0] }).match({
        sessionId: 's',
        site: 'x',
        state: 'GA',
        countyFips: '13121',
        category: 'attorney',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('never sends a contact form twice by itself', async () => {
    const fetch = vi.fn(dropped);
    const api = createApi(fetch, { retryDelaysMs: [0, 0] });
    await expect(api.lead({} as never)).rejects.toMatchObject({ status: 0, code: 'network' });
    await expect(api.tracy({} as never)).rejects.toMatchObject({ status: 0, code: 'network' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retries, saying it was the connection', async () => {
    const fetch = vi.fn(dropped);
    const error = await createApi(fetch, { retryDelaysMs: [0, 0] })
      .states()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'network', connection: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('knows a timeout from a dropped connection, and says "offline" at once when the browser knows', async () => {
    vi.useFakeTimers();
    const hang = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const pending = createApi(hang, { retryDelaysMs: [0, 0] })
      .interpret({ sessionId: 's', site: 'x', step: 'welcome', text: 'hi' })
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({ status: 0, code: 'timeout' });
    // A timeout is not tried again (the wait was long enough already).
    expect(hang).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetch = vi.fn();
    await expect(createApi(fetch).states()).rejects.toMatchObject({ code: 'offline' });
    expect(fetch).not.toHaveBeenCalled();
    offline.mockRestore();
  });

  it('says whether usage events got through, and never throws', async () => {
    await expect(
      createApi(vi.fn(dropped), { retryDelaysMs: [] }).events({} as never),
    ).resolves.toBe(false);
    await expect(
      createApi(vi.fn().mockResolvedValue(new Response(null, { status: 204 }))).events({} as never),
    ).resolves.toBe(true);
  });
});

describe('the usage events while the connection is down', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a batch that did not get through and sends it later, also when back online', async () => {
    vi.useFakeTimers();
    const sent: string[][] = [];
    let up = false;
    const events = vi.fn((request: { events: Array<{ type: string }> }) => {
      if (!up) return Promise.resolve(false);
      sent.push(request.events.map((event) => event.type));
      return Promise.resolve(true);
    });
    const tracker = createTracker({ events }, 'session', 'site');
    tracker.track('step_viewed', { step: 'welcome' });
    tracker.track('api_error', { call: 'states', status: 0, code: 'network' });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(events).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);

    up = true;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([['step_viewed', 'api_error']]);
    tracker.dispose();
  });

  it('keeps at most 100 waiting events, dropping the oldest', async () => {
    vi.useFakeTimers();
    const events = vi.fn((_request: { events: unknown[] }) => Promise.resolve(false));
    const tracker = createTracker({ events }, 'session', 'site');
    for (let i = 0; i < 160; i += 1) tracker.track('step_viewed', { step: 'welcome' });
    await vi.advanceTimersByTimeAsync(0);
    const sizes: number[] = [];
    events.mockImplementation((request: { events: unknown[] }) => {
      sizes.push(request.events.length);
      return Promise.resolve(true);
    });
    tracker.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(100);
    tracker.dispose();
  });
});

describe('reporting failed requests', () => {
  it('records which call failed and why (never what was sent), and passes the error on', async () => {
    const tracked: Array<{ type: string; data: unknown }> = [];
    const tracker = { track: (type: string, data: unknown) => void tracked.push({ type, data }) };
    const api = withErrorReports(
      fakeApi({
        states: vi.fn(() => Promise.reject(new ApiError(0, 'network'))),
        interpret: vi.fn(() => Promise.reject(new ApiError(0, 'timeout'))),
        match: vi.fn(() => Promise.reject(new ApiError(503, 'server_error'))),
      }),
      tracker as never,
    );
    await expect(api.states()).rejects.toBeInstanceOf(ApiError);
    await expect(
      api.interpret({ sessionId: 's', site: 'x', step: 'welcome', text: 'my email is a@b.co' }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(api.match({} as never)).rejects.toBeInstanceOf(ApiError);
    await api.config();
    expect(tracked).toEqual([
      { type: 'api_error', data: { call: 'states', status: 0, code: 'network' } },
      { type: 'api_error', data: { call: 'interpret', status: 0, code: 'timeout' } },
      { type: 'api_error', data: { call: 'match', status: 503, code: 'server_error' } },
    ]);
    expect(JSON.stringify(tracked)).not.toContain('a@b.co');
  });

  it('names each kind of failure', () => {
    expect(errorCode(new ApiError(0, 'network'))).toBe('network');
    expect(errorCode(new ApiError(0, 'offline'))).toBe('offline');
    expect(errorCode(new ApiError(429, 'rate_limited'))).toBe('rate_limited');
    expect(errorCode(new ApiError(400, 'not_in_match'))).toBe('not_in_match');
    expect(errorCode(new ApiError(404, 'not_found'))).toBe('other');
    expect(errorCode(new Error('bug'))).toBe('other');
    expect(errorCode(new ApiError(0, 'cancelled'))).toBeNull();
  });
});
