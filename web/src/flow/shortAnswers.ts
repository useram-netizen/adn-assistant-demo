/**
 * Short answers a visitor may type instead of tapping a button. Only whole, short replies count:
 * "yes but I moved to Cobb" is a message, and goes to the assistant like any other.
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const YES = new Set([
  'yes',
  'y',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'correct',
  'right',
  'exactly',
  'definitely',
  'absolutely',
  'yes please',
  'yes it is',
  'yes correct',
  'yes thats right',
  'yes that is right',
  'yes thats correct',
  'yes that is correct',
  'thats right',
  'that is right',
  'thats correct',
  'that is correct',
  'sure thing',
  'of course',
]);

const NO = new Set([
  'no',
  'n',
  'nope',
  'nah',
  'no thanks',
  'no thank you',
  'not really',
  'not quite',
  'wrong',
  'incorrect',
  'thats wrong',
  'that is wrong',
  'thats not right',
  'that is not right',
  'no thats wrong',
  'no it isnt',
  'no its not',
]);

/** "yes" or "no" typed after a question that has Yes and No buttons; null for anything else. */
export function yesOrNo(text: string): 'yes' | 'no' | null {
  const said = normalize(text);
  if (YES.has(said)) return 'yes';
  if (NO.has(said)) return 'no';
  return null;
}

const SKIP = new Set([
  'skip',
  'skip it',
  'skip this',
  'pass',
  'no',
  'nope',
  'nah',
  'none',
  'nothing',
  'n/a',
  'na',
  'no thanks',
  'no thank you',
  'not really',
  'nothing to add',
  'nothing to say',
  'nothing else',
  'rather not say',
  'id rather not',
  'id rather not say',
  'prefer not to say',
  'i prefer not to say',
  'no comment',
  'next',
  'continue',
]);

/** At the "tell me about your situation" step: a reply that means "I'd rather not". */
export function wantsToSkip(text: string): boolean {
  return SKIP.has(normalize(text));
}
