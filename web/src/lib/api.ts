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
  ) {
    super(`${status} ${code}`);
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }
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
  /** Fire and forget: failures are ignored. `keepalive` lets it finish while the page closes. */
  events(request: EventsRequest, keepalive?: boolean): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The widget's calls to the server (same origin; no cookies, rule 4). */
export function createApi(fetchImpl: FetchLike = (input, init) => fetch(input, init)): Api {
  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    { timeoutMs = REQUEST_TIMEOUT_MS, keepalive = false } = {},
  ): Promise<T> {
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
        const error = (await response.json().catch(() => ({}))) as { error?: unknown };
        throw new ApiError(
          response.status,
          typeof error.error === 'string' ? error.error : 'server_error',
        );
      }
      return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, 'network');
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
      return parsePublicConfig(await call<unknown>('GET', '/api/config'));
    },
    states() {
      statesCache ??= cached(
        async () => (await call<StatesResponse>('GET', '/api/states')).states,
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
    match: (request) => call('POST', '/api/match', request),
    interpret: (request) =>
      call('POST', '/api/ai/interpret', request, { timeoutMs: AI_TIMEOUT_MS }),
    county: (request) => call('POST', '/api/ai/county', request, { timeoutMs: AI_TIMEOUT_MS }),
    situation: (request) =>
      call('POST', '/api/ai/situation', request, { timeoutMs: AI_TIMEOUT_MS }),
    recommend: (request) =>
      call('POST', '/api/ai/recommend', request, { timeoutMs: AI_TIMEOUT_MS }),
    lead: (request) => call('POST', '/api/leads', request),
    tracy: (request) => call('POST', '/api/contact-tracy', request),
    async events(request, keepalive = false) {
      try {
        await call('POST', '/api/events', request, { timeoutMs: 8_000, keepalive });
      } catch {
        // Tracking never matters to the visitor.
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
