/**
 * The server-side safety keyword list (spec: Safety). Any visitor text that matches shows the
 * safety card once per session. Over-matching is fine: the card never blocks the conversation.
 * Only true/false leaves this module: the text itself is never logged or stored.
 */
const SAFETY_PATTERNS: readonly RegExp[] = [
  /\babus(?:e|es|ed|ing|ive|er)\b/i,
  /\b(?:hit|hits|hitting|beat|beats|beating|hurt|hurts|hurting|chokes?|choked|choking|kicks?|kicked|slaps?|slapped|pushe[sd]|shoves?|shoved|strangles?|strangled)\s+(?:me|us|my\s+(?:kids?|children|son|daughter|baby))\b/i,
  /\bthreat(?:s|en|ens|ened|ening)?\b/i,
  /\b(?:afraid|scared|fear(?:ful)?|terrified)\s+(?:for\s+)?(?:my|our)\s+(?:life|lives|safety)\b/i,
  /\b(?:afraid|scared|terrified)\s+(?:to\s+leave|of\s+(?:him|her|them|my\s+(?:husband|wife|spouse|partner|ex)))\b/i,
  /\bkill(?:s|ed|ing)?\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bself[-\s]?harm/i,
  /\b(?:hurt|harm|kill)(?:ing)?\s+myself\b/i,
  /\b(?:end\s+my\s+life|want\s+to\s+die|don'?t\s+want\s+to\s+live)\b/i,
  /\bunsafe\b/i,
  /\bdanger(?:ous)?\b/i,
  /\bviolen(?:ce|t)\b/i,
  /\bstalk(?:s|ed|ing|er)?\b/i,
  /\b(?:restraining|protective)\s+order\b/i,
];

export function matchesSafetyKeywords(text: string): boolean {
  return SAFETY_PATTERNS.some((pattern) => pattern.test(text));
}
