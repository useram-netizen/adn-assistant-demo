import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Port for the end-to-end test server (set E2E_PORT to run several test runs at once). */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4317);
/** The fake OpenAI API (server/test/support/mockOpenAI.ts) the test server talks to. */
export const MOCK_AI_PORT = E2E_PORT + 1;
/** A second server with AI_ENABLED=false: the whole flow must work with buttons only. */
export const AI_OFF_PORT = E2E_PORT + 2;

/** Where the widget is served from: PUBLIC_BASE_URL during the tests. */
export const WIDGET_ORIGIN = `http://localhost:${E2E_PORT}`;

/**
 * Where the host page (/embed-test) is opened. It is a different origin from WIDGET_ORIGIN,
 * so every test runs the widget as a real cross-site embed, as on GrowthZone.
 */
export const HOST_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

/** A third origin that is not in ALLOWED_EMBED_ORIGINS, to check that framing is blocked. */
export const BLOCKED_HOST_ORIGIN = `http://[::1]:${E2E_PORT}`;

export const AI_OFF_WIDGET_ORIGIN = `http://localhost:${AI_OFF_PORT}`;
export const AI_OFF_HOST_ORIGIN = `http://127.0.0.1:${AI_OFF_PORT}`;

export const JOIN_URL = 'https://example.com/join';
export const PRIVACY_URL = 'https://example.com/privacy';

/** Leads, gaps and events (JSON files) and the email previews of the test servers. */
export const E2E_DATA_DIR = join(tmpdir(), `adn-e2e-${E2E_PORT}`);
export const STORAGE_DIR = join(E2E_DATA_DIR, 'storage');
export const MAIL_PREVIEW_DIR = join(E2E_DATA_DIR, 'mail');
export const AI_OFF_STORAGE_DIR = join(E2E_DATA_DIR, 'storage-ai-off');
export const AI_OFF_MAIL_PREVIEW_DIR = join(E2E_DATA_DIR, 'mail-ai-off');
