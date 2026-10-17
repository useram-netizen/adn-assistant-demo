/**
 * Text helpers for the AI layer: removing contact details before text goes to OpenAI
 * (spec rule 2), word limits for AI replies, and the normalisation used for exact matches.
 */

// ---------------------------------------------------------------- Contact details (rule 2)

/** name@example.com, including subdomains and plus addresses. */
const EMAIL = /[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[a-z]{2,}/gi;

/**
 * An address typed with spaces or without a full domain: "jane @ gmail . com", "jane@ gmail.com",
 * "jane.doe@gmail". Anything with a word on each side of an "@" is treated as an address.
 */
const LOOSE_EMAIL = /[\p{L}\p{N}._%+-]+\s*@\s*[\p{L}\p{N}-]+(?:\s*\.\s*[\p{L}\p{N}-]+)*/gu;

/** Spelled-out addresses: "jane dot doe at gmail dot com", "jane(at)gmail(dot)com", "jane [at] gmail.com". */
const AT = String.raw`(?:\s*[([{]\s*at\s*[)\]}]\s*|\s+at\s+)`;
const DOT = String.raw`(?:\s*[([{]\s*dot\s*[)\]}]\s*|\s+dot\s+|\.)`;
const WORD = String.raw`[\p{L}\p{N}_%+-]+`;
const SPELLED_EMAIL = new RegExp(
  String.raw`${WORD}(?:${DOT}${WORD})*${AT}${WORD}(?:${DOT}${WORD})*${DOT}\p{L}{2,6}\b`,
  'giu',
);

/** "janedoe at gmail": no "dot com", but the provider gives it away. */
const PROVIDERS =
  'gmail|googlemail|yahoo|ymail|hotmail|outlook|msn|icloud|aol|proton|protonmail|comcast|verizon|sbcglobal|bellsouth|earthlink';
const PROVIDER_EMAIL = new RegExp(
  String.raw`${WORD}(?:${DOT}${WORD})*${AT}(?:${PROVIDERS})\b(?:${DOT}\p{L}{2,6}\b)*`,
  'giu',
);

/**
 * Anything that looks like a phone number: 7 or more digits, optionally starting with + or "(",
 * separated by spaces, dots, dashes, slashes, bullets or brackets. It never starts in the
 * middle of a number or right after a currency sign.
 */
const PHONE_CANDIDATE =
  /(?<![\p{N}$€£])(?:\+\s?)?(?:\(\s?)?\d(?:[ \t().\-–—/\\_•·|~*]{0,6}\d){6,18}(?!\d)/gu;

/** Number shapes that are not phone numbers and help the AI: ZIP+4, year ranges, dates. */
const NOT_A_PHONE = [
  /^\d{5}-\d{4}$/, // ZIP+4: 30060-1234
  /^(?:19|20)\d{2}\s*[-–/]\s*(?:19|20)\d{2}$/, // 2015-2019
  /^\d{1,2}[-./]\d{1,2}[-./](?:\d{2}|\d{4})$/, // 10-12-2023, 10/12/2023
];

function replacePhone(candidate: string): string {
  const digits = candidate.replace(/\D/g, '').length;
  if (digits < 7 || NOT_A_PHONE.some((shape) => shape.test(candidate))) return candidate;
  // 16–19 digits is a card or account number: not a phone, but just as private.
  return digits > 15 ? '[number]' : '[phone]';
}

/** "five five five one two three four": seven or more digits spelled out in a row. */
const NUMBER_WORD = 'zero|oh|one|two|three|four|five|six|seven|eight|nine';
const SPELLED_PHONE = new RegExp(String.raw`\b(?:(?:${NUMBER_WORD})(?:[\s,.-]+|\b)){7,}`, 'gi');

// ---------------------------------------------------------------- Names

/** A word that can be part of a name, or a capitalised one. */
const TOKEN = String.raw`[\p{L}][\p{L}'’.-]*`;
const CAPITALISED = String.raw`\p{Lu}[\p{L}'’-]*`;

/** Words that can follow a first name without being part of it ("My name is Jane and…"). */
const NOT_A_NAME = new Set([
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
  'an',
  'from',
  'in',
  'at',
  'with',
  'here',
  'too',
  'is',
  'am',
  'are',
  'was',
  'have',
  'had',
  'need',
  'needs',
  'want',
  'looking',
  'trying',
  'getting',
  'going',
  'live',
  'lives',
  'just',
  'not',
  'to',
  'for',
  'of',
  'on',
  'who',
  'that',
  'this',
  'it',
  'me',
  'us',
]);

/** Capitalised words that start a sentence after "I'm" without being a name. */
const NOT_A_NAME_AFTER_IM = new Set([
  'not',
  'sure',
  'in',
  'from',
  'a',
  'an',
  'the',
  'going',
  'divorced',
  'separated',
  'single',
  'married',
  'ready',
  'done',
  'looking',
  'trying',
  'thinking',
  'just',
  'also',
  'so',
  'very',
  'still',
  'currently',
  'fine',
  'okay',
  'ok',
  'good',
  'scared',
  'worried',
  'afraid',
  'confused',
  'lost',
  'tired',
  'here',
  'new',
  'unsure',
  'exploring',
  'curious',
]);

/** "Fulton County", "Atlanta City": a place, not a person. */
const PLACE_ENDING =
  /^(?:county|parish|borough|city|town|township|village|state|district|island)$/i;

function endsAPlace(tokens: readonly string[]): boolean {
  return PLACE_ENDING.test((tokens.at(-1) ?? '').replace(/[.,]$/, ''));
}

/**
 * "My name is Jane Smith", "call me Jane", "name: Jane Smith", "my full name is…": the intro stays
 * and the name (up to four words, ending at a word that cannot be part of one) becomes [name].
 */
const EXPLICIT_NAME = new RegExp(
  String.raw`\b(my\s+(?:(?:full|first|last|legal|real)\s+)?name(?:\s+is|['’]s)?|(?:the\s+)?name\s+is|i\s+am\s+called|i['’]m\s+called|call\s+me|known\s+as|name\s*[:=])(\s*)(${TOKEN}(?:\s+${TOKEN}){0,3})`,
  'giu',
);

function replaceExplicitName(_match: string, intro: string, space: string, words: string): string {
  const tokens = words.split(/\s+/);
  let used = 1;
  while (used < tokens.length && !NOT_A_NAME.has((tokens[used] ?? '').toLowerCase())) used += 1;
  const rest = tokens.slice(used).join(' ');
  return `${intro}${space}[name]${rest ? ` ${rest}` : ''}`;
}

/** "I'm Jane Smith", "I am Jane": capitalised words after "I'm" (which are rarely anything else). */
const IM_NAME = new RegExp(
  String.raw`\b(I['’]m|I\s+am|Im)(\s+)(${CAPITALISED}(?:\s+${CAPITALISED}){0,2})(?![\p{L}])`,
  'gu',
);

function replaceImName(match: string, intro: string, space: string, words: string): string {
  const tokens = words.split(/\s+/);
  if (NOT_A_NAME_AFTER_IM.has((tokens[0] ?? '').toLowerCase()) || endsAPlace(tokens)) return match;
  return `${intro}${space}[name]`;
}

/** "This is Jane Smith", "It's Jane Smith": two or more capitalised words ("It's Fulton" stays). */
const THIS_IS_NAME = new RegExp(
  String.raw`\b([Tt]his\s+is|[Ii]t['’]s)(\s+)(${CAPITALISED}(?:\s+${CAPITALISED}){1,2})(?![\p{L}])`,
  'gu',
);

function replaceThisIsName(match: string, intro: string, space: string, words: string): string {
  const tokens = words.split(/\s+/);
  if (NOT_A_NAME_AFTER_IM.has((tokens[0] ?? '').toLowerCase()) || endsAPlace(tokens)) return match;
  return `${intro}${space}[name]`;
}

/** "Jane Smith here, looking for a mediator". */
const NAME_HERE = new RegExp(
  String.raw`(?<![\p{L}'’-])(${CAPITALISED}(?:\s+${CAPITALISED}){0,2})(\s+here\b)`,
  'gu',
);

function replaceNameHere(match: string, words: string, here: string): string {
  const tokens = words.split(/\s+/);
  if (NOT_A_NAME_AFTER_IM.has((tokens[0] ?? '').toLowerCase()) || endsAPlace(tokens)) return match;
  return `[name]${here}`;
}

/** "Thanks, Jane Smith" or "Regards,\nJane" at the very end. */
const SIGN_OFF = new RegExp(
  String.raw`(\b(?:[Tt]hanks|[Tt]hank you|[Rr]egards|[Bb]est regards|[Kk]ind regards|[Bb]est|[Ss]incerely|[Cc]heers)\s*[,!.]?\s+)(${CAPITALISED}(?:\s+${CAPITALISED}){0,2})\s*$`,
  'gu',
);

/**
 * Replaces email addresses with [email], phone numbers with [phone] and names the visitor gives
 * ("my name is…", "I'm…", "…here") with [name], before visitor text is sent to OpenAI (rule 2).
 * Over-matching is harmless: the AI only needs the gist. If an "@" is still there afterwards
 * (an address in a shape we do not recognise), nothing of the text is sent.
 */
export function scrubContactDetails(text: string): string {
  const clean = text
    // Fullwidth "＠" and digits, and look-alikes, become plain characters.
    .normalize('NFKC')
    .replace(EMAIL, '[email]')
    .replace(LOOSE_EMAIL, '[email]')
    .replace(SPELLED_EMAIL, '[email]')
    .replace(PROVIDER_EMAIL, '[email]')
    .replace(SPELLED_PHONE, '[phone]')
    .replace(PHONE_CANDIDATE, replacePhone)
    .replace(EXPLICIT_NAME, replaceExplicitName)
    .replace(IM_NAME, replaceImName)
    .replace(THIS_IS_NAME, replaceThisIsName)
    .replace(NAME_HERE, replaceNameHere)
    .replace(SIGN_OFF, '$1[name]');
  return clean.includes('@') ? '[removed]' : clean;
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
