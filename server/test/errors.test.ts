import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redact } from '../src/lib/log.js';
import { errorHandler } from '../src/middleware/errors.js';

function appThatFails(error: unknown) {
  const app = express();
  app.get(['/api/boom', '/boom'], () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe('errorHandler', () => {
  it('returns a plain JSON error without the message or stack trace', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(appThatFails(new Error('database password is hunter2')))
      .get('/api/boom')
      .expect(500);
    expect(res.body).toEqual({ error: 'server_error' });
    expect(res.text).not.toContain('hunter2');
    expect(res.text).not.toContain('at ');
  });

  it('returns plain text outside the API', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(appThatFails(new Error('boom')))
      .get('/boom')
      .expect(500);
    expect(res.text).toBe('Something went wrong');
  });

  it('keeps client error codes', async () => {
    const error = Object.assign(new Error('Not allowed'), { status: 403 });
    const res = await request(appThatFails(error)).get('/api/boom').expect(403);
    expect(res.body).toEqual({ error: 'bad_request' });
  });

  it('logs server errors with email addresses and phone numbers removed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await request(
      appThatFails(new Error('duplicate key: { email: "jane.doe@example.com" } tel 404-555-1234')),
    )
      .get('/api/boom')
      .expect(500);
    const line = logged.mock.calls.map((call) => String(call[0])).join('\n');
    expect(line).toContain('request_failed');
    expect(line).not.toContain('jane.doe@example.com');
    expect(line).not.toContain('404-555-1234');
    expect(line).toContain('[email]');
  });
});

describe('redact', () => {
  it('removes email addresses and phone numbers', () => {
    expect(redact('mail jane.doe+adn@example.co.uk now')).toBe('mail [email] now');
    expect(redact('call (404) 555-1234 or +1 404 555 1234')).toBe('call ([number] or [number]');
  });

  it('keeps short numbers, dates and addresses that are not personal', () => {
    expect(redact('connect ECONNREFUSED 127.0.0.1:27017 on 2026-10-17, code 11000')).toBe(
      'connect ECONNREFUSED 127.0.0.1:27017 on 2026-10-17, code 11000',
    );
  });
});
