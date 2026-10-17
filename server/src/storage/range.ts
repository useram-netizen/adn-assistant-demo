import type { DateRange } from '../domain/types.js';

/**
 * True when an ISO time is inside the range. Both ends are inclusive, and no range (or an empty
 * one) matches everything. A time that can't be parsed only matches an open range.
 */
export function inRange(iso: unknown, range: DateRange = {}): boolean {
  const { from, to } = range;
  if (!from && !to) return true;
  const time = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(time)) return false;
  if (from && time < from.getTime()) return false;
  if (to && time > to.getTime()) return false;
  return true;
}

/**
 * The Date#toISOString() form of an ISO time ("2026-10-17T08:00:00.000Z"), so that times compare
 * correctly as text, as MongoDB compares them. A value that can't be parsed is kept as it is.
 */
export function canonicalTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : new Date(time).toISOString();
}
