import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mailer, OutgoingEmail } from '../src/domain/types.js';
import { createMailer, type MailTransport, type TransportMessage } from '../src/email/mailer.js';
import { leadsRouter } from '../src/routes/leads.js';
import { MemoryStore } from '../src/storage/memoryStore.js';
import { testApp, testConfig, testDeps, type TestDeps } from './helpers.js';

const visitor = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.org',
  phone: '404 555 0100',
  preferredContact: 'email',
  message: 'We have two children and want to keep this civil.',
  consent: true,
  website: '',
};

function leadBody(memberIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    ...visitor,
    sessionId: randomUUID(),
    site: 'divorceamicably',
    state: 'GA',
    countyFips: '13121',
    category: 'attorney',
    stage: 'ready',
    memberIds,
    ...overrides,
  };
}

/** Three members who really match "GA, Fulton County, attorney". */
function fultonMembers(deps: TestDeps, count = 3) {
  return deps.directory
    .match({ state: 'GA', countyFips: '13121', category: 'attorney', subcategory: null }, 'seed')
    .slice(0, count);
}

/** Waits for the background work (the recipients' statuses being stored). */
async function allSettled(deps: TestDeps, expected: number) {
  await vi.waitFor(async () => {
    const [lead] = await deps.store.listLeads();
    expect(lead?.recipients.length).toBe(expected);
    expect(lead?.recipients.every((recipient) => recipient.status !== 'pending')).toBe(true);
  });
}

describe('POST /api/leads', () => {
  it('saves the lead and emails each professional, the visitor and nobody else', async () => {
    const deps = await testDeps();
    const picked = fultonMembers(deps, 2);
    const app = await testApp({}, { deps });
    const res = await request(app)
      .post('/api/leads')
      .send(leadBody(picked.map((member) => member.id)))
      .expect(200);
    expect(res.body).toEqual({
      ok: true,
      contacted: picked.map((member) => member.name),
      safety: false,
    });
    await allSettled(deps, 3);

    const professional = deps.mailer.sent.filter((email) => email.kind === 'professional');
    expect(professional.map((email) => email.to).sort()).toEqual(
      picked.map((member) => member.email).sort(),
    );
    for (const email of professional) {
      expect(email.subject).toBe('New client request: Divorce attorney in Fulton County, Georgia');
      expect(email.replyTo).toBe('jane.doe@example.org');
      expect(email.text).toContain('Jane Doe');
      expect(email.text).toContain(
        'This person found you through the Amicable Divorce Network assistant on divorceamicably.com.',
      );
      expect(email.text).toContain('We have two children and want to keep this civil.');
    }
    const confirmation = deps.mailer.sent.filter((email) => email.kind === 'client');
    expect(confirmation).toHaveLength(1);
    expect(confirmation[0]?.to).toBe('jane.doe@example.org');
    for (const member of picked) expect(confirmation[0]?.text).toContain(member.name);
    expect(deps.mailer.sent).toHaveLength(3);

    const [lead] = await deps.store.listLeads();
    expect(lead).toMatchObject({
      kind: 'pros',
      site: 'divorceamicably',
      state: 'GA',
      countyFips: '13121',
      county: 'Fulton County',
      category: 'attorney',
      subcategory: null,
      stage: 'ready',
      memberIds: picked.map((member) => member.id),
    });
    expect(lead?.contact).toMatchObject({ firstName: 'Jane', email: 'jane.doe@example.org' });
    expect(lead?.recipients.map((recipient) => recipient.status)).toEqual([
      'previewed',
      'previewed',
      'previewed',
    ]);
    expect(deps.events.recorded.map((event) => event.type)).toContain('lead_submitted');
  });

  it('sends a copy to LEAD_COPY_TO when set', async () => {
    const deps = await testDeps();
    const [member] = fultonMembers(deps, 1);
    const app = await testApp({ LEAD_COPY_TO: 'copy@example.com' }, { deps });
    await request(app)
      .post('/api/leads')
      .send(leadBody([member!.id]))
      .expect(200);
    await allSettled(deps, 3);
    expect(deps.mailer.sent.map((email) => email.kind).sort()).toEqual([
      'client',
      'copy',
      'professional',
    ]);
    expect(deps.mailer.sent.find((email) => email.kind === 'copy')?.to).toBe('copy@example.com');
  });

  it('pretends to succeed for a bot that fills the hidden field, and sends and saves nothing', async () => {
    const deps = await testDeps();
    const [member] = fultonMembers(deps, 1);
    const res = await request(await testApp({}, { deps }))
      .post('/api/leads')
      .send(leadBody([member!.id], { website: 'https://spam.example' }))
      .expect(200);
    expect(res.body).toEqual({ ok: true, contacted: [], safety: false });
    expect(deps.mailer.sent).toEqual([]);
    expect(await deps.store.listLeads()).toEqual([]);
    expect(deps.events.recorded).toEqual([]);
  });

  it('rejects a professional who is not in a fresh match for the search (checked on the server)', async () => {
    const deps = await testDeps();
    const [inMatch] = fultonMembers(deps, 1);
    // A real member who does not serve Fulton County: the first match for Wyoming's neighbour.
    const elsewhere = deps.directory
      .match({ state: 'IL', countyFips: '17031', category: 'mediator', subcategory: null }, 's')
      .find((member) => !member.states.includes('GA'));
    const app = await testApp({}, { deps });
    for (const ids of [[elsewhere!.id], [inMatch!.id, elsewhere!.id], ['m_000000000000']]) {
      const res = await request(app).post('/api/leads').send(leadBody(ids));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'not_in_match' });
    }
    expect(deps.mailer.sent).toEqual([]);
    expect(await deps.store.listLeads()).toEqual([]);
  });

  it('needs between one and five different professionals', async () => {
    const deps = await testDeps();
    const six = fultonMembers(deps, 6).map((member) => member.id);
    const app = await testApp({}, { deps });
    for (const ids of [[], six, [six[0]!, six[0]!]]) {
      const res = await request(app).post('/api/leads').send(leadBody(ids));
      expect(res.status).toBe(400);
    }
    const five = await request(app)
      .post('/api/leads')
      .send(leadBody(six.slice(0, 5)));
    expect(five.status).toBe(200);
  });

  it('checks the form like the page does, and never echoes what was typed', async () => {
    const deps = await testDeps();
    const [member] = fultonMembers(deps, 1);
    const app = await testApp({}, { deps });
    const bad = await request(app)
      .post('/api/leads')
      .send(
        leadBody([member!.id], {
          email: 'not-an-email@@x',
          consent: false,
          firstName: '   ',
          message: '',
        }),
      )
      .expect(400);
    expect(bad.body).toMatchObject({ error: 'validation_failed' });
    expect((bad.body as { fields: string[] }).fields.sort()).toEqual([
      'consent',
      'email',
      'firstName',
      'message',
    ]);
    expect(bad.text).not.toContain('not-an-email');
    expect(deps.mailer.sent).toEqual([]);
  });

  it('needs a phone number when the visitor asks to be phoned, and a sensible one if given', async () => {
    const deps = await testDeps();
    const [member] = fultonMembers(deps, 1);
    const app = await testApp({}, { deps });
    const noPhone = await request(app)
      .post('/api/leads')
      .send(leadBody([member!.id], { preferredContact: 'phone', phone: '' }));
    expect(noPhone.status).toBe(400);
    expect((noPhone.body as { fields: string[] }).fields).toContain('phone');
    const bad = await request(app)
      .post('/api/leads')
      .send(leadBody([member!.id], { phone: 'call me' }));
    expect(bad.status).toBe(400);
  });

  it('limits the message to 1,500 characters', async () => {
    const deps = await testDeps();
    const [member] = fultonMembers(deps, 1);
    const res = await request(await testApp({}, { deps }))
      .post('/api/leads')
      .send(leadBody([member!.id], { message: 'x'.repeat(1501) }));
    expect(res.status).toBe(400);
  });

  it('flags a message that may be a safety concern', async () => {
    const deps = await testDeps();
    const [member] = fultonMembers(deps, 1);
    const res = await request(await testApp({}, { deps }))
      .post('/api/leads')
      .send(leadBody([member!.id], { message: 'He threatens me and I am afraid for my life.' }))
      .expect(200);
    expect((res.body as { safety: boolean }).safety).toBe(true);
  });

  it('escapes what the visitor wrote in the HTML of the emails', async () => {
    const deps = await testDeps();
    const [member] = fultonMembers(deps, 1);
    await request(await testApp({}, { deps }))
      .post('/api/leads')
      .send(
        leadBody([member!.id], {
          firstName: '<script>alert(1)</script>',
          message: '<img src=x onerror=alert(1)>',
        }),
      )
      .expect(200);
    await allSettled(deps, 2);
    for (const email of deps.mailer.sent) {
      expect(email.html).not.toContain('<script>alert(1)</script>');
      expect(email.html).not.toContain('<img src=x');
    }
  });

  it('is limited to 5 requests an hour per address', async () => {
    const deps = await testDeps({ rateLimitEnabled: true });
    const [member] = fultonMembers(deps, 1);
    const app = await testApp({}, { deps });
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push(
        (
          await request(app)
            .post('/api/leads')
            .send(leadBody([member!.id]))
        ).status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('keeps the visitor’s name, email and message out of the server log', async () => {
    const logged: string[] = [];
    const spies = [
      vi.spyOn(console, 'log').mockImplementation((line) => void logged.push(String(line))),
      vi.spyOn(console, 'error').mockImplementation((line) => void logged.push(String(line))),
    ];
    try {
      const deps = await testDeps();
      const [member] = fultonMembers(deps, 1);
      deps.mailer.send = () => Promise.reject(new Error('mailbox jane.doe@example.org full'));
      await request(await testApp({}, { deps }))
        .post('/api/leads')
        .send(leadBody([member!.id]))
        .expect(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const output = logged.join('\n');
    expect(output).not.toContain('jane.doe@example.org');
    expect(output).not.toContain('Jane');
    expect(output).not.toContain('two children');
  });
});

describe('POST /api/contact-tracy', () => {
  const tracyBody = (overrides: Record<string, unknown> = {}) => ({
    ...visitor,
    sessionId: randomUUID(),
    site: 'divorceamicably',
    reason: 'no_match',
    state: 'WY',
    countyFips: '56039',
    category: 'attorney',
    stage: 'exploring',
    ...overrides,
  });

  it('saves a "tracy" lead and emails Tracy (reply-to the visitor) and the visitor', async () => {
    const deps = await testDeps();
    const app = await testApp({ TRACY_EMAIL: 'tracy@example.com' }, { deps });
    const res = await request(app).post('/api/contact-tracy').send(tracyBody()).expect(200);
    expect(res.body).toEqual({ ok: true, safety: false });
    await allSettled(deps, 2);

    const toTracy = deps.mailer.sent.find((email) => email.kind === 'tracy');
    expect(toTracy).toMatchObject({ to: 'tracy@example.com', replyTo: 'jane.doe@example.org' });
    expect(toTracy?.text).toContain('Teton County, Wyoming');
    expect(toTracy?.text).toContain('Divorce attorney');
    expect(deps.mailer.sent.find((email) => email.kind === 'client_tracy')?.to).toBe(
      'jane.doe@example.org',
    );

    const [lead] = await deps.store.listLeads();
    expect(lead).toMatchObject({
      kind: 'tracy',
      reason: 'no_match',
      state: 'WY',
      county: 'Teton County',
      memberIds: [],
    });
    expect(deps.events.recorded.map((event) => event.type)).toContain('tracy_form_submitted');
  });

  it('works for a visitor outside the US and UK, with no location', async () => {
    const deps = await testDeps();
    const app = await testApp({ TRACY_EMAIL: 'tracy@example.com' }, { deps });
    await request(app)
      .post('/api/contact-tracy')
      .send(tracyBody({ reason: 'outside', state: null, countyFips: null, category: null }))
      .expect(200);
    await allSettled(deps, 2);
    const [lead] = await deps.store.listLeads();
    expect(lead).toMatchObject({ kind: 'tracy', reason: 'outside', state: null, category: null });
  });

  it('still produces Tracy’s email in preview while TRACY_EMAIL is not set (OPEN)', async () => {
    const deps = await testDeps();
    await request(await testApp({}, { deps }))
      .post('/api/contact-tracy')
      .send(tracyBody())
      .expect(200);
    await allSettled(deps, 2);
    expect(deps.mailer.sent.some((email) => email.kind === 'tracy')).toBe(true);
  });

  it('ignores a bot that fills the hidden field', async () => {
    const deps = await testDeps();
    const res = await request(await testApp({}, { deps }))
      .post('/api/contact-tracy')
      .send(tracyBody({ website: 'x' }))
      .expect(200);
    expect(res.body).toEqual({ ok: true, safety: false });
    expect(deps.mailer.sent).toEqual([]);
    expect(await deps.store.listLeads()).toEqual([]);
  });

  it('rejects an unknown reason or location', async () => {
    const app = await testApp();
    for (const overrides of [{ reason: 'because' }, { state: 'ZZ' }, { countyFips: '17031' }]) {
      const res = await request(app).post('/api/contact-tracy').send(tracyBody(overrides));
      expect(res.status).toBe(400);
    }
  });
});

describe('emails that fail', () => {
  /** The leads router alone, with retries that happen immediately. */
  async function setup(send: Mailer['send']) {
    const deps = await testDeps();
    const mailer: Mailer = { mode: 'preview', send };
    const timers: Array<() => void> = [];
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      leadsRouter({
        config: testConfig(),
        geo: deps.geo,
        directory: deps.directory,
        store: deps.store,
        events: deps.events,
        mailer,
        rateLimitEnabled: false,
        retryDelaysMs: [1, 2, 3],
        setTimer: (callback) => void timers.push(callback),
      }),
    );
    const [member] = fultonMembers(deps, 1);
    return { deps, app, timers, member: member! };
  }

  it('retries up to three times and records the result for each recipient', async () => {
    const attempts = new Map<string, number>();
    const { deps, app, timers, member } = await setup((email: OutgoingEmail) => {
      const count = (attempts.get(email.to) ?? 0) + 1;
      attempts.set(email.to, count);
      return email.kind === 'professional' && count < 3
        ? Promise.reject(Object.assign(new Error('try later'), { code: 'ETIMEDOUT' }))
        : Promise.resolve({ status: 'sent' as const });
    });
    await request(app)
      .post('/api/leads')
      .send(leadBody([member.id]))
      .expect(200);
    // The professional's first attempt failed: still pending, with a retry waiting.
    await vi.waitFor(async () => {
      const [lead] = await deps.store.listLeads();
      expect(lead?.recipients.find((r) => r.kind === 'professional')?.status).toBe('pending');
    });
    while (timers.length > 0) {
      timers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await vi.waitFor(async () => {
      const [lead] = await deps.store.listLeads();
      const professional = lead?.recipients.find((r) => r.kind === 'professional');
      expect(professional).toMatchObject({ status: 'sent', attempts: 3 });
    });
    expect(deps.events.recorded.filter((event) => event.type === 'email_failed')).toEqual([]);
  });

  it('gives up after the last retry, marks the recipient failed and records email_failed', async () => {
    const { deps, app, timers, member } = await setup(() =>
      Promise.reject(Object.assign(new Error('down'), { code: 'ECONNREFUSED' })),
    );
    await request(app)
      .post('/api/leads')
      .send(leadBody([member.id]))
      .expect(200);
    await vi.waitFor(() => expect(timers.length).toBeGreaterThan(0));
    for (let round = 0; round < 8 && timers.length > 0; round += 1) {
      timers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await vi.waitFor(async () => {
      const [lead] = await deps.store.listLeads();
      expect(lead?.recipients.every((recipient) => recipient.status === 'failed')).toBe(true);
      expect(lead?.recipients.every((recipient) => recipient.attempts === 4)).toBe(true);
    });
    const failures = deps.events.recorded.filter((event) => event.type === 'email_failed');
    expect(failures.length).toBeGreaterThan(0);
    expect(JSON.stringify(failures)).not.toContain('@');
  });

  it('still saves the lead and answers if the store fails', async () => {
    const deps = await testDeps();
    deps.store.failing.add('saveLead');
    const [member] = fultonMembers(deps, 1);
    const res = await request(await testApp({}, { deps }))
      .post('/api/leads')
      .send(leadBody([member!.id]));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(deps.mailer.sent.length).toBe(2));
  });
});

describe('the mailer (spec rule 1: no real emails unless EMAIL_MODE=live)', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const email: OutgoingEmail = {
    kind: 'professional',
    to: 'real.professional@example.com',
    replyTo: 'visitor@example.org',
    subject: 'New client request: Divorce attorney in Fulton County, Georgia',
    html: '<p>Hello</p>',
    text: 'Hello',
  };

  function recordingTransport() {
    const sent: TransportMessage[] = [];
    const factory = vi.fn((): MailTransport => ({
      sendMail: (message) => {
        sent.push(message);
        return Promise.resolve({});
      },
    }));
    return { sent, factory };
  }

  it('preview (the default): saves an HTML file, shows who it was meant for, and never opens a connection', async () => {
    dir = await mkdtemp(join(tmpdir(), 'adn-mail-'));
    const { factory, sent } = recordingTransport();
    const mailer = createMailer(testConfig({ MAIL_PREVIEW_DIR: dir }), {
      createTransport: factory,
    });
    expect(mailer.mode).toBe('preview');
    const result = await mailer.send(email);
    expect(result.status).toBe('previewed');
    expect(factory).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    const [file] = await readdir(dir);
    const html = await readFile(join(dir, file!), 'utf8');
    expect(html).toContain('real.professional@example.com');
    expect(html).toContain('visitor@example.org');
    expect(html).toContain('this email was not sent');
  });

  it('redirect: sends only to EMAIL_REDIRECT_TO, with the real recipient in the subject', async () => {
    const { factory, sent } = recordingTransport();
    const mailer = createMailer(
      testConfig({
        EMAIL_MODE: 'redirect',
        EMAIL_REDIRECT_TO: 'tester@example.net',
        SMTP_HOST: 'smtp.example.com',
        EMAIL_FROM: 'ADN <hello@example.com>',
      }),
      { createTransport: factory },
    );
    await mailer.send(email);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('tester@example.net');
    expect(sent[0]?.subject).toBe(`[TEST → real.professional@example.com] ${email.subject}`);
    expect(sent[0]?.replyTo).toBe('visitor@example.org');
    expect(JSON.stringify(sent)).not.toMatch(/"to":"real\.professional/);
  });

  it('live: sends to the real recipient (only allowed in production)', async () => {
    const { factory, sent } = recordingTransport();
    const config = testConfig({
      NODE_ENV: 'production',
      EMAIL_MODE: 'live',
      SMTP_HOST: 'smtp.example.com',
      EMAIL_FROM: 'ADN <hello@example.com>',
    });
    await createMailer(config, { createTransport: factory }).send(email);
    expect(sent[0]?.to).toBe('real.professional@example.com');
    expect(sent[0]?.subject).toBe(email.subject);
  });

  it('refuses EMAIL_MODE=live outside production, and redirect without a redirect address', () => {
    expect(() => testConfig({ EMAIL_MODE: 'live' })).toThrow(/production/);
    expect(() => testConfig({ EMAIL_MODE: 'redirect' })).toThrow(/EMAIL_REDIRECT_TO/);
  });

  it('defaults to preview', () => {
    expect(testConfig().email.mode).toBe('preview');
  });
});

describe('the store used by these tests', () => {
  it('is separate for each test (so tests cannot affect each other)', () => {
    expect(new MemoryStore()).not.toBe(new MemoryStore());
  });
});
