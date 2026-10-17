import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { copy, fill } from '../config/copy.js';
import type { Config } from '../config/env.js';
import type { Mailer, OutgoingEmail, SendResult } from '../domain/types.js';
import { escapeHtml } from '../lib/html.js';

/**
 * Sends the emails in one of three modes (EMAIL_MODE, spec rule 1):
 * - preview (the default): nothing is sent. Each email is saved as an HTML file in
 *   config.paths.mailPreviewDir, with To, Reply-To and Subject shown at the top.
 *   No SMTP connection is ever made in this mode.
 * - redirect: real SMTP, but every email goes to EMAIL_REDIRECT_TO, with the real recipient
 *   in the subject: "[TEST → real@address] …".
 * - live: real SMTP to the real recipients (config only allows it with NODE_ENV=production).
 */

/** The message handed to the SMTP transport. */
export interface TransportMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

/** The part of a nodemailer transport the mailer uses (tests pass a stub). */
export interface MailTransport {
  sendMail(message: TransportMessage): Promise<unknown>;
}

/** Settings for nodemailer's pooled SMTP transport. */
export interface SmtpOptions {
  pool: true;
  /** A few connections at most: some providers limit parallel SMTP sessions. */
  maxConnections: number;
  host: string;
  port: number;
  /** TLS from the start (port 465); otherwise STARTTLS. */
  secure: boolean;
  /** Port 587 must upgrade to TLS before the password is sent. */
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

export type TransportFactory = (options: SmtpOptions) => MailTransport;

export interface MailerOverrides {
  /** Creates the SMTP transport. Called once, on the first send; never in preview mode. */
  createTransport?: TransportFactory;
  /** Preview file names: the clock and a short random id. */
  now?: () => Date;
  randomId?: () => string;
}

/** A sending problem of our own (as opposed to an SMTP error). `code` is safe to store. */
export class MailerError extends Error {
  override name = 'MailerError';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** The sender shown in previews while EMAIL_FROM is not set. Never used for real sending. */
const PREVIEW_FROM = `${copy.emails.brand} <no-reply@localhost> (EMAIL_FROM is not set)`;

const emailAddress = z.email();

const defaultTransportFactory: TransportFactory = (options) => createTransport(options);

export function createMailer(config: Config, overrides: MailerOverrides = {}): Mailer {
  return config.email.mode === 'preview'
    ? previewMailer(config, overrides)
    : smtpMailer(config, overrides);
}

// ---------------------------------------------------------------- preview

function previewMailer(config: Config, overrides: MailerOverrides): Mailer {
  const dir = config.paths.mailPreviewDir;
  const now = overrides.now ?? (() => new Date());
  const randomId = overrides.randomId ?? (() => randomBytes(3).toString('hex'));
  const from = config.email.from ?? PREVIEW_FROM;

  return {
    mode: 'preview',
    async send(email: OutgoingEmail): Promise<SendResult> {
      // Created on each send, so deleting the folder while the server runs is fine.
      // The files hold visitors' details: readable by this user only.
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, previewFileName(now(), email.kind, randomId()));
      await writeFile(file, previewHtml(email, from), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      return { status: 'previewed', file };
    },
  };
}

/** "2026-10-17T05-12-33-123Z_professional_a1b2c3.html": sorts by time, safe on every OS. */
export function previewFileName(date: Date, kind: OutgoingEmail['kind'], id: string): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  const safeId = id.replace(/[^a-z0-9]/gi, '').slice(0, 16) || 'x';
  return `${stamp}_${kind}_${safeId}.html`;
}

/** The email's HTML with a visible block at the top showing how it would have been sent. */
export function previewHtml(email: OutgoingEmail, from: string): string {
  const row = (label: string, value: string) =>
    `<div><strong>${label}:</strong> ${escapeHtml(value)}</div>`;
  const header = `
<div style="margin:0;padding:12px 16px;background-color:#fff7d6;border-bottom:2px solid #b45309;color:#1f2937;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere;">
<div><strong>EMAIL PREVIEW: this email was not sent (EMAIL_MODE=preview).</strong></div>
${row('Mode', 'preview')}
${row('Kind', email.kind)}
${row('From', from)}
${row('To', email.to)}
${row('Reply-To', email.replyTo ?? '(none)')}
${row('Subject', email.subject)}
<details><summary>Plain-text version</summary><pre style="white-space:pre-wrap;">${escapeHtml(email.text)}</pre></details>
</div>
`;
  // A replacement function, so "$" in the content is never treated as a pattern.
  const withHeader = email.html.replace(/<body\b[^>]*>/i, (tag) => `${tag}${header}`);
  return withHeader === email.html ? `${header}${email.html}` : withHeader;
}

// ---------------------------------------------------------------- redirect and live

export function smtpOptions(smtp: Config['email']['smtp'] & { host: string }): SmtpOptions {
  return {
    pool: true,
    maxConnections: 3,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port === 587,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.pass ?? '' } } : {}),
    // nodemailer waits up to 2 minutes by default; the visitor is waiting for the first try.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
}

/** EMAIL_FROM, else the SMTP user when it is an email address (as the brand). */
export function senderAddress(config: Config): string | null {
  if (config.email.from) return config.email.from;
  const user = config.email.smtp.user;
  if (user && emailAddress.safeParse(user).success) return `${copy.emails.brand} <${user}>`;
  return null;
}

function smtpMailer(config: Config, overrides: MailerOverrides): Mailer {
  const mode = config.email.mode;
  const factory = overrides.createTransport ?? defaultTransportFactory;
  const from = senderAddress(config);
  let transport: MailTransport | undefined;

  function getTransport(): MailTransport {
    const { host } = config.email.smtp;
    if (!host) throw new MailerError('smtp_host_unset', 'SMTP_HOST is not set');
    transport ??= factory(smtpOptions({ ...config.email.smtp, host }));
    return transport;
  }

  /** In redirect mode everything goes to EMAIL_REDIRECT_TO; the subject names the real recipient. */
  function addressing(email: OutgoingEmail): { to: string | undefined; subject: string } {
    if (mode === 'redirect') {
      return {
        to: config.email.redirectTo,
        subject: fill(copy.emails.redirectSubject, { to: email.to, subject: email.subject }),
      };
    }
    return { to: email.to, subject: email.subject };
  }

  return {
    mode,
    async send(email: OutgoingEmail): Promise<SendResult> {
      if (!from) {
        throw new MailerError(
          'email_from_unset',
          'Set EMAIL_FROM (or an SMTP_USER that is an email address)',
        );
      }
      const { to, subject } = addressing(email);
      if (!to || !emailAddress.safeParse(to).success) {
        throw new MailerError('invalid_recipient', 'The recipient is not an email address');
      }
      const message: TransportMessage = { from, to, subject, html: email.html, text: email.text };
      if (email.replyTo) message.replyTo = email.replyTo;
      await getTransport().sendMail(message);
      return { status: 'sent' };
    },
  };
}
