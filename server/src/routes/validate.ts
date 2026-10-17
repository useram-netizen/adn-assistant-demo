import type { Response } from 'express';
import { z } from 'zod';
import type { Geo } from '../domain/types.js';
import type { ApiError } from '../shared/api.js';

/** Request checks shared by the routes. Errors name the bad fields, never their values. */

/** The site key from data-site; anything else counts as "unknown" rather than failing the request. */
export const siteSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
  .catch('unknown')
  .default('unknown');

export const sessionIdSchema = z.uuid();

/** A visitor's typed text: trimmed, 1 to 1,000 characters (spec: "Limits and fallback"). */
export const visitorTextSchema = z.string().trim().min(1).max(1000);

/** A USPS code of one of the 50 states + DC. */
export function stateSchema(geo: Geo) {
  return z
    .string()
    .transform((value) => value.toUpperCase())
    .refine((code) => geo.state(code) !== undefined);
}

/** Sends 400 validation_failed, with the names of the fields that failed (never their values). */
export function sendValidationError(res: Response, error: z.ZodError): void {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || 'body'))];
  const body: ApiError = { error: 'validation_failed', fields };
  res.status(400).json(body);
}
