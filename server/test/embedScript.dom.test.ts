import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { copy } from '../src/config/copy.js';
import { buildEmbedScript } from '../src/embed/embedScript.js';
import { embedScriptPath } from '../src/paths.js';
import { BASE_URL, testConfig } from './helpers.js';

// The exact script the server sends: minified, with its settings filled in.
const served = buildEmbedScript(embedScriptPath, testConfig());

function newDom(body: string) {
  return new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url: 'https://host-site.example/page',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
}

function loaded(dom: JSDOM): Promise<void> {
  const { document } = dom.window;
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve()));
}

/** A fresh, fully loaded host page (another site) for each test. */
async function hostPage(body = '') {
  const dom = newDom(body);
  await loaded(dom);
  return pageHelpers(dom);
}

function pageHelpers(dom: JSDOM) {
  const { window } = dom;
  const { document } = window;

  /** Adds embed.js the way the snippet does: a script tag with data attributes. */
  const runEmbed = (attributes: Record<string, string> = {}, parent: Element = document.body) => {
    const script = document.createElement('script');
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.textContent = served;
    parent.appendChild(script);
    return script;
  };

  const frames = () => Array.from(document.querySelectorAll('iframe'));

  /** Delivers a postMessage as if `from` had sent it. */
  const post = (from: HTMLIFrameElement | Window | null, data: unknown, origin = BASE_URL) => {
    const source = from && 'contentWindow' in from ? from.contentWindow : from;
    window.dispatchEvent(new window.MessageEvent('message', { data, origin, source }));
  };

  return { window, document, runEmbed, frames, post };
}

describe('embed.js inline mode', () => {
  it('puts a full-width iframe in the target element', async () => {
    const page = await hostPage('<div id="adn-assistant"></div>');
    page.runEmbed({ 'data-target': 'adn-assistant', 'data-site': 'divorceamicably' });

    const [frame] = page.frames();
    expect(frame?.parentElement?.id).toBe('adn-assistant');
    expect(frame?.getAttribute('src')).toBe(`${BASE_URL}/widget?site=divorceamicably&mode=inline`);
    expect(frame?.title).toBe(copy.embed.frameTitle);
    expect(frame?.style.width).toBe('100%');
    expect(frame?.style.height).toBe('480px');
    expect(frame?.style.getPropertyPriority('height')).toBe('important');
  });

  it('follows adn:resize messages from the widget', async () => {
    const page = await hostPage('<div id="adn-assistant"></div>');
    page.runEmbed();
    const [frame] = page.frames();
    page.post(frame!, { type: 'adn:resize', height: 612 });
    expect(frame?.style.height).toBe('612px');
  });

  it('ignores messages from other origins and other windows', async () => {
    const page = await hostPage('<div id="adn-assistant"></div>');
    page.runEmbed();
    const [frame] = page.frames();
    page.post(frame!, { type: 'adn:resize', height: 600 }, 'https://evil.example');
    page.post(page.window as unknown as Window, { type: 'adn:resize', height: 600 });
    page.post(null, { type: 'adn:resize', height: 600 });
    expect(frame?.style.height).toBe('480px');
  });

  it.each([['600'], [-10], [0], [Number.NaN], [1e6], [null]])(
    'ignores an invalid height (%s)',
    async (height) => {
      const page = await hostPage('<div id="adn-assistant"></div>');
      page.runEmbed();
      const [frame] = page.frames();
      page.post(frame!, { type: 'adn:resize', height });
      expect(frame?.style.height).toBe('480px');
    },
  );

  it('stays between 320 px and the window height', async () => {
    const page = await hostPage('<div id="adn-assistant"></div>');
    page.runEmbed();
    const [frame] = page.frames();
    page.post(frame!, { type: 'adn:resize', height: 100 });
    expect(frame?.style.height).toBe('320px');
    page.post(frame!, { type: 'adn:resize', height: 5000 });
    expect(frame?.style.height).toBe(`${Math.max(400, page.window.innerHeight - 24)}px`);
  });

  it('creates the target next to the script when the page lost it', async () => {
    const page = await hostPage('<section id="wrapper"></section>');
    const wrapper = page.document.getElementById('wrapper')!;
    const script = page.runEmbed({ 'data-target': 'adn-assistant' }, wrapper);

    const host = page.document.getElementById('adn-assistant');
    expect(host?.parentElement).toBe(wrapper);
    expect(host?.nextElementSibling).toBe(script);
    expect(host?.querySelector('iframe')).not.toBeNull();
  });

  it('defaults to the adn-assistant target and an unknown site', async () => {
    const page = await hostPage('<div id="adn-assistant"></div>');
    page.runEmbed();
    expect(page.frames()[0]?.getAttribute('src')).toBe(
      `${BASE_URL}/widget?site=unknown&mode=inline`,
    );
  });

  it('waits until the page has loaded when it runs early', async () => {
    const dom = newDom('<div id="adn-assistant"></div>');
    const page = pageHelpers(dom);
    expect(page.document.readyState).toBe('loading');
    page.runEmbed();
    expect(page.frames()).toHaveLength(0);
    await loaded(dom);
    expect(page.frames()).toHaveLength(1);
  });

  it('does not embed twice into the same target', async () => {
    const page = await hostPage('<div id="adn-assistant"></div>');
    page.runEmbed();
    page.runEmbed();
    expect(page.frames()).toHaveLength(1);
  });

  it('reads settings from the script URL when data attributes are missing', async () => {
    const page = await hostPage('<div id="custom-slot"></div>');
    // A tag with only a src, as left by a page editor that strips data-* attributes.
    const external = page.document.createElement('script');
    external.src = `${BASE_URL}/embed.js?target=custom-slot&site=amicabledivorce`;
    page.document.body.appendChild(external);
    page.runEmbed();

    const inSlot = page.document.querySelector('#custom-slot iframe');
    expect(inSlot?.getAttribute('src')).toBe(`${BASE_URL}/widget?site=amicabledivorce&mode=inline`);
  });
});

describe('embed.js bubble mode', () => {
  async function bubblePage() {
    const page = await hostPage();
    page.runEmbed({ 'data-mode': 'bubble', 'data-site': 'divorceamicably' });
    const button = page.document.getElementById('adn-bubble') as HTMLButtonElement;
    const panel = page.document.getElementById('adn-panel') as HTMLDivElement;
    return { ...page, button, panel };
  }

  it('adds a "Find a professional" button and a hidden panel, without loading the widget yet', async () => {
    const { button, panel, frames } = await bubblePage();
    expect(button.textContent).toBe(copy.embed.bubbleLabel);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.style.position).toBe('fixed');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.style.display).toBe('none');
    expect(frames()).toHaveLength(0);
  });

  it('opens the widget in the panel and focuses the close button', async () => {
    const { button, panel, frames, document } = await bubblePage();
    button.click();
    expect(panel.style.display).toBe('block');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(frames()[0]?.getAttribute('src')).toBe(
      `${BASE_URL}/widget?site=divorceamicably&mode=bubble`,
    );
    expect(document.activeElement?.getAttribute('aria-label')).toBe(copy.embed.closeLabel);
    // Desktop size: jsdom has no matchMedia, so it never counts as a phone.
    expect(panel.style.width).toBe('400px');
    expect(panel.style.height).toBe('640px');
  });

  it('closes with Esc and returns focus to the button', async () => {
    const { button, panel, document, window } = await bubblePage();
    button.click();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.style.display).toBe('none');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes with the close button and keeps the conversation for next time', async () => {
    const { button, panel, frames } = await bubblePage();
    button.click();
    panel.querySelector('button')!.click();
    expect(panel.style.display).toBe('none');
    button.click();
    expect(panel.style.display).toBe('block');
    expect(frames()).toHaveLength(1);
  });

  it('closes when the widget sends adn:close (Esc pressed inside it)', async () => {
    const { button, panel, frames, post } = await bubblePage();
    button.click();
    const [frame] = frames();
    post(frame!, { type: 'adn:close' }, 'https://evil.example');
    expect(panel.style.display).toBe('block');
    post(frame!, { type: 'adn:close' });
    expect(panel.style.display).toBe('none');
  });

  it('adds only one bubble per page', async () => {
    const { runEmbed, document } = await bubblePage();
    runEmbed({ 'data-mode': 'bubble' });
    expect(document.querySelectorAll('#adn-bubble')).toHaveLength(1);
  });
});
