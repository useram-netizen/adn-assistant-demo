/** Public settings from GET /api/config. Links that are not set are null and stay hidden. */
export interface PublicConfig {
  links: {
    join: string | null;
    ukSite: string | null;
    articles: string | null;
    podcast: string | null;
    booking: string | null;
    privacy: string | null;
  };
}

const LINK_KEYS = ['join', 'ukSite', 'articles', 'podcast', 'booking', 'privacy'] as const;
const REQUEST_TIMEOUT_MS = 10_000;

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
  const rawLinks = typeof data === 'object' && data !== null && 'links' in data ? data.links : null;
  const source = (typeof rawLinks === 'object' && rawLinks !== null ? rawLinks : {}) as Record<
    string,
    unknown
  >;
  const links = Object.fromEntries(LINK_KEYS.map((key) => [key, httpLink(source[key])]));
  return { links: links as PublicConfig['links'] };
}

export async function fetchPublicConfig(signal: AbortSignal): Promise<PublicConfig> {
  const response = await fetch('/api/config', {
    headers: { Accept: 'application/json' },
    // Rule 4: no cookies. The widget keeps everything in memory.
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`GET /api/config failed with ${response.status}`);
  return parsePublicConfig(await response.json());
}

/** Fetches the config, giving up after 10 seconds. `cancel` aborts quietly. */
export function loadPublicConfig(): { promise: Promise<PublicConfig>; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const promise = fetchPublicConfig(controller.signal).finally(() => clearTimeout(timer));
  return {
    promise,
    cancel: () => {
      clearTimeout(timer);
      controller.abort();
    },
  };
}
