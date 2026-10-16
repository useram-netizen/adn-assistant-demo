/** How the widget was opened, read from its URL (/widget?site=...&mode=...). */
export type EmbedMode = 'inline' | 'bubble' | 'standalone';

export interface EmbedContext {
  /** Site key from data-site, kept for tracking. */
  site: string;
  /** inline and bubble come from embed.js; anything else (the fallback iframe, a direct visit) is standalone. */
  mode: EmbedMode;
  /** True when the widget runs inside an iframe. */
  framed: boolean;
}

const SITE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function readEmbedContext(search: string, win: Window): EmbedContext {
  const params = new URLSearchParams(search);
  const site = (params.get('site') ?? '').trim().toLowerCase();
  const mode = params.get('mode');
  return {
    site: SITE_PATTERN.test(site) ? site : 'unknown',
    mode: mode === 'inline' || mode === 'bubble' ? mode : 'standalone',
    framed: isFramed(win),
  };
}

function isFramed(win: Window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true; // reading window.top can throw in a cross-origin frame
  }
}
