import { describe, expect, it } from 'vitest';
import { parsePublicConfig } from '../src/lib/api';
import { readEmbedContext } from '../src/lib/embedContext';

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
