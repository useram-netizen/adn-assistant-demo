import { copy } from '../config/copy.js';
import type { Config } from '../config/env.js';
import { escapeHtml } from '../lib/html.js';

/**
 * /embed-test plays the part of a host site (like a GrowthZone page). It shows the embed
 * codes to paste and runs them live, loading everything from PUBLIC_BASE_URL exactly as a
 * real site would. Open it on a different host name than PUBLIC_BASE_URL (for example
 * 127.0.0.1 instead of localhost) to test a real cross-site embed.
 *
 * Query parameters (all optional, checked against fixed lists):
 * - mode: inline | bubble | fallback   show one embed only (default: all three)
 * - width: 320 | 375 | 600 | 800       width of the area around the inline and fallback embeds
 * - site: a site key such as divorceamicably (passed through as data-site)
 */
export interface EmbedTestOptions {
  mode: 'all' | 'inline' | 'bubble' | 'fallback';
  width: number | null;
  site: string;
}

const MODES = ['inline', 'bubble', 'fallback'] as const;
const WIDTHS = [320, 375, 600, 800] as const;
const SITE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function parseEmbedTestOptions(query: Record<string, unknown>): EmbedTestOptions {
  const mode = MODES.find((value) => value === query.mode) ?? 'all';
  const width = WIDTHS.find((value) => String(value) === query.width) ?? null;
  const site =
    typeof query.site === 'string' && SITE_PATTERN.test(query.site)
      ? query.site
      : 'divorceamicably';
  return { mode, width, site };
}

export interface EmbedSnippets {
  inline: string;
  bubble: string;
  fallback: string;
}

/** The codes Tracy's web guy pastes into a page. */
export function embedSnippets(baseUrl: string, site: string): EmbedSnippets {
  const base = escapeHtml(baseUrl);
  const siteValue = escapeHtml(site);
  return {
    inline: `<div id="adn-assistant"></div>\n<script src="${base}/embed.js" data-target="adn-assistant" data-site="${siteValue}" async></script>`,
    bubble: `<script src="${base}/embed.js" data-mode="bubble" data-site="${siteValue}" async></script>`,
    fallback: `<iframe src="${base}/widget?site=${siteValue}" title="${escapeHtml(copy.embed.frameTitle)}" style="width:100%;height:760px;border:0"></iframe>`,
  };
}

export function renderEmbedTestPage(config: Config, options: EmbedTestOptions): string {
  const snippets = embedSnippets(config.publicBaseUrl, options.site);
  const show = (mode: (typeof MODES)[number]) => options.mode === 'all' || options.mode === mode;
  const slotStyle = options.width ? ` style="max-width:${options.width}px"` : '';

  const link = (label: string, params: Partial<Record<'mode' | 'width', string>>) => {
    const query = new URLSearchParams();
    const mode = params.mode ?? (options.mode === 'all' ? undefined : options.mode);
    const width = params.width ?? (options.width ? String(options.width) : undefined);
    if (mode && mode !== 'all') query.set('mode', mode);
    if (width && width !== 'full') query.set('width', width);
    if (options.site !== 'divorceamicably') query.set('site', options.site);
    const search = query.toString();
    const href = `/embed-test${search ? `?${search}` : ''}`;
    return `<a href="${escapeHtml(href)}">${label}</a>`;
  };

  const sections: string[] = [];
  if (show('inline')) {
    sections.push(`
    <section id="inline" aria-labelledby="inline-title">
      <h2 id="inline-title">Inline (default)</h2>
      <p>Paste this where the assistant should appear. It fills the width of its column and grows with the conversation.</p>
      <pre><code>${escapeHtml(snippets.inline)}</code></pre>
      <div class="slot"${slotStyle}>
        ${snippets.inline}
      </div>
    </section>`);
  }
  if (show('bubble')) {
    sections.push(`
    <section id="bubble" aria-labelledby="bubble-title">
      <h2 id="bubble-title">Bubble</h2>
      <p>Paste this once per page. It adds the <strong>${escapeHtml(copy.embed.bubbleLabel)}</strong> button at the bottom right of this page; the button opens the assistant in a panel (full screen on phones).</p>
      <pre><code>${escapeHtml(snippets.bubble)}</code></pre>
      ${snippets.bubble}
    </section>`);
  }
  if (show('fallback')) {
    sections.push(`
    <section id="fallback" aria-labelledby="fallback-title">
      <h2 id="fallback-title">Fallback: plain iframe</h2>
      <p>Use this only if the page editor removes &lt;script&gt; tags. It has a fixed height, and the conversation scrolls inside it.</p>
      <pre><code>${escapeHtml(snippets.fallback)}</code></pre>
      <div class="slot"${slotStyle}>
        ${snippets.fallback}
      </div>
    </section>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>ADN assistant embed test</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #f1ede4; color: #1e2b30; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    header, main { max-width: 960px; margin: 0 auto; padding: 0 16px; }
    header { padding-top: 24px; }
    h1 { margin: 0 0 4px; font-size: 1.6rem; }
    h2 { margin: 0 0 8px; font-size: 1.2rem; }
    p { margin: 0 0 12px; }
    nav { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 12px 0 0; font-size: 0.95rem; }
    nav span { color: #57666b; }
    a { color: #1f5f69; }
    section { margin: 24px 0; padding: 20px 16px; background: #fbf9f4; border: 1px solid #ddd6c8; border-radius: 12px; }
    pre { margin: 0 0 16px; padding: 12px; overflow-x: auto; background: #fff; border: 1px solid #ddd6c8; border-radius: 8px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-all; }
    .slot { margin: 0 auto; }
    main { padding-bottom: 120px; }
  </style>
</head>
<body>
  <header>
    <h1>ADN assistant: embed test</h1>
    <p>This page stands in for a host site such as a GrowthZone page. It loads the assistant from <code>${escapeHtml(config.publicBaseUrl)}</code> with the same codes shown below.</p>
    <nav aria-label="Test options">
      <span>Show:</span> ${link('All', { mode: 'all' })} ${link('Inline', { mode: 'inline' })} ${link('Bubble', { mode: 'bubble' })} ${link('Fallback iframe', { mode: 'fallback' })}
      <span>Width:</span> ${link('320', { width: '320' })} ${link('375', { width: '375' })} ${link('600', { width: '600' })} ${link('800', { width: '800' })} ${link('Full', { width: 'full' })}
    </nav>
  </header>
  <main>${sections.join('\n')}
  </main>
</body>
</html>
`;
}
