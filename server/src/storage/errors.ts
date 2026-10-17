/**
 * A short code for an error that is safe to log: the system or driver code ("ENOENT",
 * "DuplicateKey", "11000"), else the error's class name. Never the message, which can quote the
 * stored data (a duplicate key error quotes the key, for example).
 */
export function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { code, codeName, name } = error as { code?: unknown; codeName?: unknown; name?: unknown };
  const raw =
    typeof code === 'string'
      ? code
      : typeof codeName === 'string'
        ? codeName
        : typeof code === 'number'
          ? String(code)
          : typeof name === 'string'
            ? name
            : '';
  return raw.replace(/[^\w.-]/g, '').slice(0, 64) || 'unknown';
}

/** Thrown by a store's operations after close(). */
export class StoreClosedError extends Error {
  override name = 'StoreClosedError';
  readonly code = 'store_closed';

  constructor() {
    super('The store is closed');
  }
}
