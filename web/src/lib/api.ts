import type {
  CountiesResponse,
  CountyFromPlaceRequest,
  CountyFromPlaceResponse,
  CountyOption,
  EventsRequest,
  InterpretRequest,
  InterpretResponse,
  LeadRequest,
  LeadResponse,
  MatchRequest,
  MatchResponse,
  PublicConfigResponse,
  RecommendRequest,
  RecommendResponse,
  SituationRequest,
  SituationResponse,
  StateOption,
  StatesResponse,
  TracyRequest,
  TracyResponse,
} from '@adn/api';

/** Public settings from GET /api/config. Links that are not set are null and stay hidden. */
export type PublicConfig = PublicConfigResponse;

const LINK_KEYS = ['join', 'ukSite', 'articles', 'podcast', 'booking', 'privacy'] as const;
const REQUEST_TIMEOUT_MS = 15_000;
/** The server allows the AI 10 s plus one retry, so wait a little longer than that. */
const AI_TIMEOUT_MS = 28_000;
/**
 * Waits before trying again after a request got no answer (a dropped connection, a moment of
 * bad wifi). Only requests that change nothing are tried again: never the contact forms.
 */
const RETRY_DELAYS_MS: readonly number[] = [700, 2_000];

function httpLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Keeps only well-formed http(s) links, so the widget never renders anything unexpected. */
export function parsePublicConfig(data: unknown): PublicConfig {
  const object = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const root = object(data);
  const source = object(root.links);
  const features = object(root.features);
  const links = Object.fromEntries(LINK_KEYS.map((key) => [key, httpLink(source[key])]));
  return {
    links: links as PublicConfig['links'],
    features: { ai: features.ai === true, showProContact: features.showProContact === true },
  };
}

/** A request that failed. `status` is 0 when there was no answer (offline or timed out). */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    /** The form fields the server did not accept (a 400 `validation_failed`). */
    readonly fields: readonly string[] = [],
  ) {
    super(`${status} ${code}`);
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }

  /** No answer from the server at all: the connection, not the server (status 0). */
  get connection(): boolean {
    return this.status === 0 && this.code !== 'cancelled';
  }
}

/** True for a request that got no answer at all (see ApiError.connection). */
export function isConnectionProblem(error: unknown): boolean {
  return error instanceof ApiError && error.connection;
}

export interface Api {
  config(): Promise<PublicConfig>;
  states(): Promise<StateOption[]>;
  counties(state: string): Promise<CountyOption[]>;
  match(request: MatchRequest): Promise<MatchResponse>;
  interpret(request: InterpretRequest): Promise<InterpretResponse>;
  county(request: CountyFromPlaceRequest): Promise<CountyFromPlaceResponse>;
  situation(request: SituationRequest): Promise<SituationResponse>;
  recommend(request: RecommendRequest): Promise<RecommendResponse>;
  lead(request: LeadRequest): Promise<LeadResponse>;
  tracy(request: TracyRequest): Promise<TracyResponse>;
  /**
   * Never throws: resolves false when the events did not get through (the tracker keeps them
   * and tries again). `keepalive` lets it finish while the page closes.
   */
  events(request: EventsRequest, keepalive?: boolean): Promise<boolean>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface CallOptions {
  timeoutMs?: number;
  keepalive?: boolean;
  /** How many times to try again after no answer, or a 502/503/504 (requests that change nothing). */
  retries?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The widget's calls to the server (same origin; no cookies, rule 4). */
export function createApi(
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  { retryDelaysMs = RETRY_DELAYS_MS }: { retryDelaysMs?: readonly number[] } = {},
): Api {
  /** One request, tried again after a dropped connection or a busy server when `retries` allows. */
  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: CallOptions = {},
  ): Promise<T> {
    const retries = Math.min(options.retries ?? 0, retryDelaysMs.length);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await callOnce<T>(method, path, body, options);
      } catch (error) {
        const again =
          error instanceof ApiError &&
          (error.code === 'network' || [502, 503, 504].includes(error.status));
        if (!again || attempt >= retries) throw error;
        await wait(retryDelaysMs[attempt] ?? 0);
      }
    }
  }

  async function callOnce<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    { timeoutMs = REQUEST_TIMEOUT_MS, keepalive = false }: CallOptions,
  ): Promise<T> {
    // The browser knows it is offline: say so without waiting for a timeout.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError(0, 'offline');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(path, {
        method,
        headers:
          body === undefined
            ? { Accept: 'application/json' }
            : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Rule 4: no cookies. The widget keeps everything in memory.
        credentials: 'omit',
        cache: 'no-store',
        keepalive,
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          fields?: unknown;
        };
        throw new ApiError(
          response.status,
          typeof error.error === 'string' ? error.error : 'server_error',
          Array.isArray(error.fields)
            ? error.fields
                .filter((field): field is string => typeof field === 'string')
                .slice(0, 20)
            : [],
        );
      }
      return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // No answer: the wait ran out, or the request never got through.
      throw new ApiError(0, controller.signal.aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  // The lists never change while the page is open.
  let statesCache: Promise<StateOption[]> | null = null;
  const countiesCache = new Map<string, Promise<CountyOption[]>>();
  /** A failed load is not cached, so "Try again" really tries again. */
  const cached = <T>(
    load: () => Promise<T>,
    store: (value: Promise<T> | null) => void,
  ): Promise<T> => {
    const promise = load();
    store(promise);
    promise.catch(() => store(null));
    return promise;
  };

  return {
    async config() {
      return parsePublicConfig(
        await call<unknown>('GET', '/api/config', undefined, { retries: 2 }),
      );
    },
    states() {
      statesCache ??= cached(
        async () =>
          (await call<StatesResponse>('GET', '/api/states', undefined, { retries: 2 })).states,
        (value) => {
          statesCache = value;
        },
      );
      return statesCache;
    },
    counties(state) {
      let list = countiesCache.get(state);
      if (!list) {
        list = cached(
          async () =>
            (
              await call<CountiesResponse>(
                'GET',
                `/api/counties?state=${encodeURIComponent(state)}`,
                undefined,
                { retries: 2 },
              )
            ).counties,
          (value) => {
            if (value) countiesCache.set(state, value);
            else countiesCache.delete(state);
          },
        );
      }
      return list;
    },
    // A search and the AI calls change nothing, so they can be tried again.
    match: (request) => call('POST', '/api/match', request, { retries: 2 }),
    interpret: (request) =>
      call('POST', '/api/ai/interpret', request, { timeoutMs: AI_TIMEOUT_MS, retries: 1 }),
    county: (request) =>
      call('POST', '/api/ai/county', request, { timeoutMs: AI_TIMEOUT_MS, retries: 1 }),
    situation: (request) =>
      call('POST', '/api/ai/situation', request, { timeoutMs: AI_TIMEOUT_MS, retries: 1 }),
    recommend: (request) =>
      call('POST', '/api/ai/recommend', request, { timeoutMs: AI_TIMEOUT_MS, retries: 1 }),
    // Never tried again by themselves: a request that did arrive would be sent twice.
    lead: (request) => call('POST', '/api/leads', request),
    tracy: (request) => call('POST', '/api/contact-tracy', request),
    async events(request, keepalive = false) {
      try {
        await call('POST', '/api/events', request, { timeoutMs: 8_000, keepalive });
        return true;
      } catch {
        // Tracking never matters to the visitor; the tracker tries again later.
        return false;
      }
    },
  };
}

/** Starts a request and gives a way to cancel it (used while the settings load). */
export function loadPublicConfig(api: Api = createApi()): {
  promise: Promise<PublicConfig>;
  cancel: () => void;
} {
  let cancelled = false;
  const promise = api.config().then((config) => {
    if (cancelled) throw new ApiError(0, 'cancelled');
    return config;
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
  };
}
