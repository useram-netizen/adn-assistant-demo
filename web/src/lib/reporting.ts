import type { ApiCallName, ApiErrorCode } from '@adn/api';
import { ApiError, type Api } from './api';
import type { Tracker } from './events';

/** The calls that report their failures (events never do: they are how failures are reported). */
const CALLS: ReadonlyArray<readonly [keyof Api, ApiCallName]> = [
  ['config', 'config'],
  ['states', 'states'],
  ['counties', 'counties'],
  ['match', 'match'],
  ['interpret', 'interpret'],
  ['county', 'county'],
  ['situation', 'situation'],
  ['recommend', 'recommend'],
  ['lead', 'lead'],
  ['tracy', 'tracy'],
];

/** Why a request failed, as an api_error event names it. Null for a cancelled request. */
export function errorCode(error: unknown): ApiErrorCode | null {
  if (!(error instanceof ApiError)) return 'other';
  if (error.code === 'cancelled') return null;
  if (error.status === 0) {
    return error.code === 'timeout' || error.code === 'offline' ? error.code : 'network';
  }
  if (error.status === 429) return 'rate_limited';
  if (error.status >= 500) return 'server_error';
  if (error.code === 'validation_failed' || error.code === 'not_in_match') return error.code;
  return 'other';
}

/**
 * The same calls, each failure also recorded as an api_error event (which call, the status, the
 * reason; never what was sent). A request that never reached the server leaves no trace in its
 * log; this way it does, once the connection is back.
 */
export function withErrorReports(api: Api, tracker: Pick<Tracker, 'track'>): Api {
  const methods = api as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
  const reported = { ...api };
  for (const [method, call] of CALLS) {
    (reported as Record<string, unknown>)[method] = (...args: never[]) =>
      methods[method]!(...args).catch((error: unknown) => {
        const code = errorCode(error);
        if (code) {
          const status = error instanceof ApiError ? error.status : 0;
          tracker.track('api_error', { call, status, code });
        }
        throw error;
      });
  }
  return reported;
}
