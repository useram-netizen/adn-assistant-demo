import { escapeHtml } from '../lib/html.js';

/**
 * Building blocks for the emails. Each block is written twice, as HTML and as plain text,
 * so every email has both versions. Blocks take plain text and escape it themselves: the
 * templates never build HTML from visitor input.
 *
 * The HTML is deliberately simple: one column at most 600px wide, inline styles (email
 * clients drop <style> blocks), 16px text, and colours with at least 7:1 contrast.
 */

export interface Block {
  html: string;
  text: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const COLOR = {
  text: '#1f2937',
  muted: '#4b5563',
  link: '#1d4ed8',
  border: '#d1d5db',
  page: '#f3f4f6',
  card: '#ffffff',
  quote: '#f9fafb',
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Escapes text for HTML and keeps its line breaks. */
export function htmlText(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

function anchor(label: string, href: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${COLOR.link};">${htmlText(label)}</a>`;
}

export function paragraph(text: string): Block {
  return { html: `<p style="margin:0 0 16px;">${htmlText(text)}</p>`, text };
}

/** The brand line at the top of every email. */
export function brand(text: string): Block {
  return {
    html: `<p style="margin:0 0 20px;font-size:14px;font-weight:bold;color:${COLOR.muted};">${htmlText(text)}</p>`,
    text,
  };
}

export function heading(text: string): Block {
  return {
    html: `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3;color:${COLOR.text};">${htmlText(text)}</h2>`,
    text: `${text}\n${'-'.repeat(Math.min(text.length, 60))}`,
  };
}

function quoteHtml(text: string): string {
  return `<div style="margin:4px 0 16px;padding:12px 16px;border-left:4px solid ${COLOR.border};background-color:${COLOR.quote};">${htmlText(text)}</div>`;
}

/** The visitor's own message, set apart from our wording. */
export function quote(text: string): Block {
  return { html: quoteHtml(text), text };
}

export function bulletList(items: readonly string[]): Block {
  const html = items.map((item) => `<li style="margin:0 0 4px;">${htmlText(item)}</li>`).join('');
  return {
    html: `<ul style="margin:0 0 16px;padding-left:24px;">${html}</ul>`,
    text: items.map((item) => `- ${item}`).join('\n'),
  };
}

export interface LinkItem {
  label: string;
  href: string;
}

export function linkList(items: readonly LinkItem[]): Block {
  const html = items
    .map((item) => `<li style="margin:0 0 8px;">${anchor(item.label, item.href)}</li>`)
    .join('');
  return {
    html: `<ul style="margin:0 0 16px;padding-left:24px;">${html}</ul>`,
    text: items.map((item) => `- ${item.label}: ${item.href}`).join('\n'),
  };
}

export interface DetailRow {
  label: string;
  value: string;
  /** Makes the value a link (mailto: or tel:). */
  href?: string;
  /** Shows the value as a quoted block (the visitor's message). */
  quoted?: boolean;
}

/** Label and value pairs, stacked (not side by side) so they stay readable on phones. */
export function details(rows: readonly DetailRow[]): Block {
  const html = rows
    .map((row) => {
      const label = `<strong style="display:block;font-size:14px;color:${COLOR.muted};">${htmlText(row.label)}</strong>`;
      if (row.quoted) return `<div style="margin:0 0 12px;">${label}${quoteHtml(row.value)}</div>`;
      const value = row.href ? anchor(row.value, row.href) : htmlText(row.value);
      return `<p style="margin:0 0 12px;">${label}${value}</p>`;
    })
    .join('');
  const text = rows
    .map((row) => (row.quoted ? `${row.label}:\n${row.value}` : `${row.label}: ${row.value}`))
    .join('\n');
  return { html, text };
}

/** Puts the blocks into a complete email: an HTML document and the plain-text version. */
export function renderEmail(subject: string, blocks: readonly Block[]): EmailContent {
  const body = blocks.map((block) => block.html).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.page};">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:${COLOR.card};border-radius:8px;">
<tr>
<td style="padding:24px;font-family:${FONT};font-size:16px;line-height:1.5;color:${COLOR.text};text-align:left;overflow-wrap:anywhere;word-break:break-word;">
${body}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
  const text = `${blocks.map((block) => block.text).join('\n\n')}\n`;
  return { subject, html, text };
}
