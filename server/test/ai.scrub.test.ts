import { describe, expect, it } from 'vitest';
import { scrubContactDetails } from '../src/ai/text.js';

/**
 * Rule 2: no name, email address or phone number goes to OpenAI. Each case lists what must not
 * survive; the cases come from an independent review's probes (spaced, spelled-out, fullwidth and
 * oddly separated forms), plus the forms the first version handled.
 */
const mustRemove: Array<{ text: string; secret: string[] }> = [
  // ---- emails
  { text: 'reach me at jane.doe@gmail.com', secret: ['jane.doe', 'gmail'] },
  { text: 'JANE.DOE@GMAIL.COM works', secret: ['JANE.DOE'] },
  { text: 'jane.doe+divorce@gmail.com', secret: ['jane.doe+divorce'] },
  { text: 'jane at gmail dot com', secret: ['jane at gmail'] },
  { text: 'jane dot doe at gmail dot com', secret: ['jane dot doe'] },
  { text: 'jane(at)gmail(dot)com', secret: ['jane(at)'] },
  { text: 'jane [at] gmail [dot] com', secret: ['jane [at]'] },
  { text: 'jane AT gmail DOT com', secret: ['jane AT'] },
  { text: 'email me: jane @ gmail . com', secret: ['jane @', 'gmail'] },
  { text: 'email me: jane@ gmail.com', secret: ['jane@'] },
  { text: 'jane＠gmail.com (fullwidth at-sign)', secret: ['jane＠', 'jane@'] },
  { text: 'jane at gmail dot ca', secret: ['jane at gmail dot ca'] },
  { text: 'jane at yahoo dot co dot uk', secret: ['jane at yahoo'] },
  { text: 'jane at gmail dot de', secret: ['jane at gmail dot de'] },
  { text: 'my email is janedoe at gmail', secret: ['janedoe at gmail'] },
  { text: 'jane.doe@gmail', secret: ['jane.doe@gmail'] },
  { text: 'josé.garcía@correo.es', secret: ['josé.garcía'] },
  { text: 'jane_doe1980 at hotmail dot com.', secret: ['jane_doe1980'] },
  // ---- phone numbers
  { text: 'call 555-123-4567', secret: ['555-123-4567', '123-4567'] },
  { text: 'call (555) 123-4567', secret: ['123-4567'] },
  { text: 'call 555.123.4567', secret: ['555.123.4567'] },
  { text: 'call 5551234567', secret: ['5551234567'] },
  { text: 'call +1 555 123 4567', secret: ['555 123 4567'] },
  { text: 'call 1 (555) 123-4567', secret: ['123-4567'] },
  { text: 'call 555 1234', secret: ['555 1234'] },
  { text: 'call 555/123/4567', secret: ['555/123/4567', '4567'] },
  { text: 'call 555_123_4567', secret: ['555_123_4567', '4567'] },
  { text: 'call 555 • 123 • 4567', secret: ['555 •', '4567'] },
  { text: 'call five five five one two three four five six seven', secret: ['five five five'] },
  { text: 'call four oh four five five five one two one two', secret: ['four oh four'] },
  { text: 'call 555-123-4567 ext. 89', secret: ['555-123-4567'] },
  { text: 'call 555  -  123  -  4567', secret: ['4567'] },
  { text: 'call +44 7911 123456', secret: ['7911 123456'] },
  { text: 'call ５５５１２３４５６７ (fullwidth digits)', secret: ['５５５', '5551234567'] },
  { text: 'call 5 5 5 1 2 3 4 5 6 7', secret: ['5 5 5 1 2 3'] },
  { text: 'call 555-12 3-45 67', secret: ['555-12'] },
  { text: 'text me on whatsapp 404 555 12 12', secret: ['404 555'] },
  // ---- names
  { text: 'My name is Jane Smith and my husband left', secret: ['Jane', 'Smith'] },
  { text: 'my name is jane smith', secret: ['jane', 'smith'] },
  { text: 'My name is Mary Ann Smith', secret: ['Mary', 'Ann', 'Smith'] },
  { text: 'My name is Jean-Luc Picard Jr.', secret: ['Jean', 'Picard'] },
  { text: "I'm Jane Smith and my husband and I are splitting", secret: ['Jane', 'Smith'] },
  { text: 'Hi, I’m Jane Smith', secret: ['Jane', 'Smith'] },
  { text: 'This is Jane Smith', secret: ['Jane', 'Smith'] },
  { text: 'Jane Smith here, looking for a mediator', secret: ['Jane', 'Smith'] },
  { text: 'call me Jane', secret: ['Jane'] },
  { text: 'name: Jane Smith', secret: ['Jane', 'Smith'] },
  { text: 'My full name is Jane Smith', secret: ['Jane', 'Smith'] },
  { text: 'My legal name is Jane Smith', secret: ['Jane', 'Smith'] },
  { text: 'Thanks, Jane Smith', secret: ['Jane', 'Smith'] },
  { text: 'Regards,\nJane Smith', secret: ['Jane', 'Smith'] },
  { text: 'I am Jane Smith', secret: ['Jane', 'Smith'] },
  { text: 'Name is Jane Smith, phone is whatever', secret: ['Jane', 'Smith'] },
];

/** Ordinary text that carries no contact details must reach the AI as it is. */
const mustKeep = [
  "It's Fulton County",
  "It's Cobb",
  "I'm in Atlanta",
  "I'm not sure",
  "I'm Not Sure",
  "I'm Going Through a Divorce",
  'I live in Cobb County, near Marietta',
  'We have 2 kids, ages 4 and 7, and have been married 12 years',
  'ZIP 30060',
  'ZIP 30060-1234',
  'married in 2015 and filed 10/12/2023, then 10-12-2023, 2015-2019',
  'I make $85,000 and he makes $120,000; we owe $1,250,000 on the house',
  'This is hard',
  'my husband yells at me and I live at home',
  'We were at live music at noon',
  'Georgia',
  'I need someone to look at our 401k and the house at 5 Main Street',
];

describe('scrubContactDetails (rule 2)', () => {
  it.each(mustRemove)('removes the details from "$text"', ({ text, secret }) => {
    const clean = scrubContactDetails(text);
    for (const piece of secret) expect(clean, `"${piece}" in "${clean}"`).not.toContain(piece);
  });

  it.each(mustKeep)('leaves "%s" alone', (text) => {
    expect(scrubContactDetails(text)).toBe(text);
  });

  it('keeps the rest of the sentence, so the AI still has the gist', () => {
    expect(scrubContactDetails('My name is Jane Smith and my husband left')).toBe(
      'My name is [name] and my husband left',
    );
    expect(scrubContactDetails('call 555-123-4567 about the house')).toBe(
      'call [phone] about the house',
    );
    expect(scrubContactDetails('email jane.doe@gmail.com please')).toBe('email [email] please');
    expect(scrubContactDetails("Hi, I'm Jane Smith, in Cobb County")).toBe(
      "Hi, I'm [name], in Cobb County",
    );
  });

  it('sends none of the text when an address is left that it cannot parse', () => {
    expect(scrubContactDetails('write to me @@ jane')).toBe('[removed]');
    expect(scrubContactDetails('reach me @')).toBe('[removed]');
    // A handle with a word on both sides is scrubbed like an address.
    expect(scrubContactDetails('my handle is @janedoe')).toBe('my handle [email]');
  });

  it('is fast on long, awkward text (a 1,000-character message)', () => {
    const awkward = [
      'a'.repeat(1000),
      'a b '.repeat(250),
      '1 '.repeat(500),
      '5-'.repeat(500),
      ('I am ' + 'Ab ').repeat(200),
      'a@'.repeat(500),
      'word at '.repeat(125),
      'jane dot '.repeat(110),
      'one '.repeat(250),
    ];
    for (const text of awkward) {
      const start = performance.now();
      scrubContactDetails(text);
      expect(performance.now() - start, text.slice(0, 20)).toBeLessThan(250);
    }
  });
});
