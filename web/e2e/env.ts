/** Port for the end-to-end test server (set E2E_PORT to run several test runs at once). */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4317);

/** Where the widget is served from: PUBLIC_BASE_URL during the tests. */
export const WIDGET_ORIGIN = `http://localhost:${E2E_PORT}`;

/**
 * Where the host page (/embed-test) is opened. It is a different origin from WIDGET_ORIGIN,
 * so every test runs the widget as a real cross-site embed, as on GrowthZone.
 */
export const HOST_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

/** A third origin that is not in ALLOWED_EMBED_ORIGINS, to check that framing is blocked. */
export const BLOCKED_HOST_ORIGIN = `http://[::1]:${E2E_PORT}`;

export const JOIN_URL = 'https://example.com/join';
export const PRIVACY_URL = 'https://example.com/privacy';
