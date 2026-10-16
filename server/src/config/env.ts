import { z } from 'zod';
import { DEFAULT_EMBED_ORIGINS, parseEmbedOrigins } from '../security/embedOrigins.js';

/**
 * Every setting from .env, checked with zod when the server starts (see .env.example).
 * Settings for later milestones are parsed here too, so there is one place to look.
 */

const httpUrl = z.url({ protocol: /^https?$/, error: 'must be a full http(s) URL' });

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Scheme and host only, returned as the URL origin (no trailing slash). */
const originUrl = httpUrl
  .refine(
    (value) => {
      // zod runs this even when the URL check above failed, so the value may not parse.
      const url = parseUrl(value);
      return (
        url !== null &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    },
    { error: 'must be just the scheme and host, for example https://assistant.example.com' },
  )
  .transform((value) => parseUrl(value)?.origin ?? value);

const email = z.email({ error: 'must be an email address' });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_BASE_URL: originUrl.default('http://localhost:3000'),

    MONGODB_URI: z.string().optional(),
    MONGODB_DB: z.string().default('adn_matcher'),

    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-6-luna'),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    AI_ENABLED: z.stringbool().default(true),
    MAX_AI_CALLS_PER_SESSION: z.coerce.number().int().min(0).default(20),
    STORE_TRANSCRIPTS: z.stringbool().default(false),

    EMAIL_MODE: z.enum(['preview', 'redirect', 'live']).default('preview'),
    EMAIL_REDIRECT_TO: email.optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    LEAD_COPY_TO: email.optional(),
    TRACY_EMAIL: email.optional(),

    ADMIN_TOKEN: z.string().min(16, { error: 'must be at least 16 characters' }).optional(),

    ALLOWED_EMBED_ORIGINS: z.string().default(DEFAULT_EMBED_ORIGINS),

    JOIN_URL: httpUrl.optional(),
    UK_SITE_URL: httpUrl.default('https://amicabledivorcenetwork.co.uk'),
    ARTICLES_URL: httpUrl.optional(),
    PODCAST_URL: httpUrl.optional(),
    BOOKING_URL: httpUrl.optional(),
    PRIVACY_URL: httpUrl.optional(),

    SHOW_PRO_CONTACT: z.stringbool().default(false),
    LEAD_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  })
  .superRefine((env, ctx) => {
    // Rule 1: real sending must be switched on deliberately, and only in production.
    if (env.EMAIL_MODE === 'live' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_MODE'],
        message: 'live is only allowed when NODE_ENV=production',
      });
    }
    if (env.EMAIL_MODE === 'redirect' && !env.EMAIL_REDIRECT_TO) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_REDIRECT_TO'],
        message: 'is required when EMAIL_MODE=redirect',
      });
    }
    const { invalid } = parseEmbedOrigins(env.ALLOWED_EMBED_ORIGINS);
    if (invalid.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOWED_EMBED_ORIGINS'],
        message: `not valid origins: ${invalid.join(' ')} (use *, or origins like https://example.com or http://localhost:*)`,
      });
    }
  });

export type EmailMode = 'preview' | 'redirect' | 'live';

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  /** Origin of this server, for example https://assistant.example.com. */
  publicBaseUrl: string;
  mongodb: { uri?: string; db: string };
  ai: {
    enabled: boolean;
    apiKey?: string;
    model: string;
    timeoutMs: number;
    maxCallsPerSession: number;
    storeTranscripts: boolean;
  };
  email: {
    mode: EmailMode;
    redirectTo?: string;
    smtp: { host?: string; port: number; user?: string; pass?: string };
    from?: string;
    leadCopyTo?: string;
    tracyEmail?: string;
  };
  adminToken?: string;
  embed: {
    /** CSP sources allowed to frame /widget; may contain "*". */
    allowedOrigins: string[];
  };
  links: {
    join?: string;
    ukSite: string;
    articles?: string;
    podcast?: string;
    booking?: string;
    privacy?: string;
  };
  showProContact: boolean;
  leadRetentionDays?: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Parses environment variables into a Config. Empty values count as unset. Throws ConfigError. */
export function loadConfig(source: Record<string, string | undefined>): Config {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const trimmed = value?.trim();
    if (trimmed) cleaned[key] = trimmed;
  }

  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    // zod 4 does not include the input values in issues, so secrets are never printed.
    throw new ConfigError(`Invalid settings in .env:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    mongodb: { uri: env.MONGODB_URI, db: env.MONGODB_DB },
    ai: {
      enabled: env.AI_ENABLED,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      maxCallsPerSession: env.MAX_AI_CALLS_PER_SESSION,
      storeTranscripts: env.STORE_TRANSCRIPTS,
    },
    email: {
      mode: env.EMAIL_MODE,
      redirectTo: env.EMAIL_REDIRECT_TO,
      smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS },
      from: env.EMAIL_FROM,
      leadCopyTo: env.LEAD_COPY_TO,
      tracyEmail: env.TRACY_EMAIL,
    },
    adminToken: env.ADMIN_TOKEN,
    embed: { allowedOrigins: parseEmbedOrigins(env.ALLOWED_EMBED_ORIGINS).sources },
    links: {
      join: env.JOIN_URL,
      ukSite: env.UK_SITE_URL,
      articles: env.ARTICLES_URL,
      podcast: env.PODCAST_URL,
      booking: env.BOOKING_URL,
      privacy: env.PRIVACY_URL,
    },
    showProContact: env.SHOW_PRO_CONTACT,
    leadRetentionDays: env.LEAD_RETENTION_DAYS,
  };
}

/** Problems worth a warning at startup that should not stop the server. */
export function configWarnings(config: Config): string[] {
  const warnings: string[] = [];
  if (config.nodeEnv === 'production' && !config.publicBaseUrl.startsWith('https://')) {
    warnings.push(
      'PUBLIC_BASE_URL is not https. Browsers block http iframes and scripts on https sites, so the widget will not load on the host sites.',
    );
  }
  if (config.embed.allowedOrigins.includes('*')) {
    warnings.push(
      'ALLOWED_EMBED_ORIGINS=* lets any site show the widget. Fine for the first GrowthZone test; narrow it before launch.',
    );
  }
  return warnings;
}
