/**
 * Text helpers for the AI layer: removing contact details before text goes to OpenAI
 * (spec rule 2), word limits for AI replies, and the normalisation used for exact matches.
 */

// ---------------------------------------------------------------- Contact details (rule 2)

/** name@example.com, including subdomains and plus addresses. */
const EMAIL = /[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[a-z]{2,}/gi;

/** Spelled-out addresses: "jane dot doe at gmail dot com", "jane(at)gmail(dot)com", "jane [at] gmail.com". */
const AT = String.raw`(?:\s*[([{]\s*at\s*[)\]}]\s*|\s+at\s+)`;
const DOT = String.raw`(?:\s*[([{]\s*dot\s*[)\]}]\s*|\s+dot\s+|\.)`;
const WORD = String.raw`[\p{L}\p{N}_%+-]+`;
const SPELLED_EMAIL = new RegExp(
  String.raw`${WORD}(?:${DOT}${WORD})*${AT}${WORD}(?:${DOT}${WORD})*${DOT}(?:com|net|org|edu|gov|us|co|io|info|biz|me|uk)\b`,
  'giu',
);

/**
 * Anything that looks like a phone number: 7 or more digits, optionally starting with + or "(",
 * separated by spaces, dots, dashes or brackets. It never starts in the middle of a number or
 * right after a currency sign.
 */
const PHONE_CANDIDATE = /(?<![\p{N}$€£])(?:\+\s?)?(?:\(\s?)?\d(?:[ \t().\-–]{0,3}\d){6,18}(?!\d)/gu;

/** Number shapes that are not phone numbers and help the AI: ZIP+4, year ranges, dates. */
const NOT_A_PHONE = [
  /^\d{5}-\d{4}$/, // ZIP+4: 30060-1234
  /^(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}$/, // 2015-2019
  /^\d{1,2}[-.]\d{1,2}[-.](?:\d{2}|\d{4})$/, // 10-12-2023
];

function replacePhone(candidate: string): string {
  const digits = candidate.replace(/\D/g, '').length;
  if (digits < 7 || NOT_A_PHONE.some((shape) => shape.test(candidate))) return candidate;
  // 16–19 digits is a card or account number: not a phone, but just as private.
  return digits > 15 ? '[number]' : '[phone]';
}

/** "My name is Jane Smith" → "My name is [name]". */
const NAME_INTRO =
  /\b(my name is|my name['’]s|i am called|i['’]m called)(\s+)([\p{L}'’-]+)((?:\s+[\p{L}'’-]+)?)/giu;

/** Words that can follow a first name without being a surname ("My name is Jane and…"). */
const NOT_A_SURNAME = new Set([
  'and',
  'but',
  'or',
  'so',
  'i',
  'im',
  'i’m',
  "i'm",
  'we',
  'my',
  'our',
  'the',
  'a',
  'from',
  'in',
  'at',
  'with',
  'here',
  'too',
]);

function replaceName(_match: string, intro: string, space: string, _first: string, rest: string) {
  const next = rest.trim().toLowerCase();
  return `${intro}${space}[name]${next && NOT_A_SURNAME.has(next) ? rest : ''}`;
}

/**
 * Replaces email addresses with [email] and phone numbers with [phone] (and a self-introduced
 * name with [name]) before visitor text is sent to OpenAI. Over-matching is harmless: the AI
 * only needs the gist.
 */
export function scrubContactDetails(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(SPELLED_EMAIL, '[email]')
    .replace(PHONE_CANDIDATE, replacePhone)
    .replace(NAME_INTRO, replaceName);
}

// ---------------------------------------------------------------- Word limits

/** Ends with sentence punctuation, maybe followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/**
 * Keeps at most `maxWords` words. Longer text is cut at the last full sentence that keeps at
 * least half the words, otherwise at a word boundary with "…". Whitespace is collapsed.
 */
export function limitWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  const kept = words.slice(0, Math.max(0, maxWords));
  const shortest = Math.max(1, Math.ceil(maxWords / 2));
  for (let count = kept.length; count >= shortest; count -= 1) {
    if (SENTENCE_END.test(kept[count - 1] ?? '')) return kept.slice(0, count).join(' ');
  }
  const cut = kept.join(' ').replace(/[\s,;:–—-]+$/, '');
  return cut ? `${cut}…` : '';
}

// ---------------------------------------------------------------- Exact matches

/**
 * A comparison key that ignores case, accents, spaces and punctuation:
 * "Doña Ana County" → "donaanacounty", "I'm not sure" → "imnotsure", "not_sure" → "notsure".
 */
export function matchKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
