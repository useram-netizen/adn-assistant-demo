/**
 * A deterministic shuffle: the same seed always gives the same order, so results are fair
 * across visitors (each session ID gives its own order) but stable for one visitor.
 * Not for anything secret: this is about fairness, not security.
 */

/** 32-bit FNV-1a hash of a string's UTF-16 code units. */
export function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a small PRNG with 32 bits of state. Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** A shuffled copy (Fisher–Yates), driven by a PRNG seeded from `seed`. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(hash32(seed));
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const item = result[i] as T;
    result[i] = result[j] as T;
    result[j] = item;
  }
  return result;
}
