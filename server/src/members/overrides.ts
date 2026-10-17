import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { isValidEmail, normalizeEmail } from './fields.js';

/**
 * data/member-overrides.json: manual decisions keyed by email, applied after every other
 * import rule (spec: "Member import", rule 12), for example
 * { "x@y.com": { "exclude": true, "reason": "Left the network" } }.
 */

export interface MemberOverride {
  /** Leave the member out of search (reason code "excluded"). */
  exclude?: boolean;
  /** Why, for the import report. */
  reason?: string;
}

/** Keyed by trimmed, lower-case email. */
export type MemberOverrides = Readonly<Record<string, MemberOverride>>;

export class OverridesError extends Error {
  override name = 'OverridesError';
}

const OverrideSchema = z.strictObject({
  exclude: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

const OverridesSchema = z.record(z.string(), OverrideSchema);

/** Checks parsed JSON. Throws OverridesError naming the problem. */
export function parseOverrides(json: unknown, source = 'member-overrides.json'): MemberOverrides {
  const parsed = OverridesSchema.safeParse(json);
  if (!parsed.success) {
    throw new OverridesError(`${source} is not valid:\n${z.prettifyError(parsed.error)}`);
  }

  const overrides: Record<string, MemberOverride> = {};
  for (const [key, override] of Object.entries(parsed.data)) {
    const email = normalizeEmail(key);
    if (!isValidEmail(email)) {
      throw new OverridesError(`${source}: "${key}" is not an email address`);
    }
    if (Object.hasOwn(overrides, email)) {
      throw new OverridesError(`${source}: ${email} is listed more than once`);
    }
    overrides[email] = override;
  }
  return overrides;
}

/** Reads the overrides file. A missing (or empty) file means no overrides. */
export async function readOverridesFile(path: string): Promise<MemberOverrides> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw new OverridesError(`${path} can't be read (${code ?? String(error)})`);
  }
  if (!text.trim()) return {};

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new OverridesError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseOverrides(json, path);
}
