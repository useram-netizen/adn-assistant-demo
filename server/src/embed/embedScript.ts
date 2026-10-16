import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { copy } from '../config/copy.js';
import type { Config } from '../config/env.js';
import { scriptSafeJson } from '../lib/html.js';

/** The spec's size limit for the served embed.js. */
export const EMBED_SCRIPT_MAX_BYTES = 5 * 1024;

const PLACEHOLDER = '__ADN_EMBED_CONFIG__';

/** What embed.js receives: this server's origin and the wording it puts on the host page. */
export function embedSettings(config: Config) {
  return {
    base: config.publicBaseUrl,
    t: {
      bubble: copy.embed.bubbleLabel,
      close: copy.embed.closeLabel,
      title: copy.embed.frameTitle,
    },
  };
}

/** Minifies static/embed.js and fills in its settings. Runs once, when the app is created. */
export function buildEmbedScript(sourcePath: string, config: Config): string {
  const source = readFileSync(sourcePath, 'utf8');
  const { code } = transformSync(source, {
    loader: 'js',
    minify: true,
    target: 'es2017',
    legalComments: 'none',
  });
  if (!code.includes(PLACEHOLDER)) {
    throw new Error(`embed.js no longer contains ${PLACEHOLDER}`);
  }
  return code.replace(PLACEHOLDER, () => scriptSafeJson(embedSettings(config)));
}
