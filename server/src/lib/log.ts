/**
 * A tiny structured logger: one JSON line per entry.
 * Never pass visitor names, emails, phone numbers or chat text (spec: Security and privacy).
 */
type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;

const quiet = process.env.NODE_ENV === 'test';

function write(level: Level, message: string, fields?: Fields): void {
  if (quiet && level === 'info') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...fields });
  if (level === 'info') console.log(line);
  else console.error(line);
}

export const log = {
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};

/**
 * Scrubs email addresses and phone-like numbers from text we did not write ourselves,
 * such as error messages from libraries, before it is logged.
 */
export function redact(text: string): string {
  // Long text is cut first: the patterns below take longer the longer the text is.
  return text
    .slice(0, 4000)
    .replace(/[^\s@"'<>()[\]{}]+@[^\s@"'<>()[\]{}]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (match) =>
      match.replace(/\D/g, '').length >= 9 ? '[number]' : match,
    );
}
