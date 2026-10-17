import { readFile } from 'node:fs/promises';
import { APIConnectionTimeoutError, APIError } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiClient, type CreateResponse, type StructuredRequest } from '../src/ai/client.js';
import { SYSTEM_PROMPT } from '../src/ai/systemPrompt.js';
import { limitWords, matchKey, scrubContactDetails } from '../src/ai/text.js';
import { testConfig } from './helpers.js';

const request: StructuredRequest = {
  kind: 'interpret',
  schemaName: 'interpret',
  schema: {
    type: 'object',
    properties: { a: { type: 'number' } },
    required: ['a'],
    additionalProperties: false,
  },
  input: { task: 'Do the task.', data: { visitor_text: 'hello' } },
};

const config = testConfig({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'test-model' });
const reply = (text: string, tokens = 42) => ({
  status: 'completed',
  output_text: text,
  usage: { total_tokens: tokens },
});

function client(createResponse: CreateResponse, overrides = {}) {
  const made = createAiClient(config, { createResponse, retryDelayMs: 0, ...overrides });
  if (!made) throw new Error('no client');
  return made;
}

// The real API answers { error: { message, code, param } }, and the SDK reads the inner object.
const apiError = (status: number, body: Record<string, unknown>) =>
  APIError.generate(
    status,
    { error: body },
    typeof body.message === 'string' ? body.message : 'error',
    new Headers(),
  );

afterEach(() => vi.restoreAllMocks());

describe('createAiClient', () => {
  it('is null when the AI is off or there is no key', () => {
    expect(
      createAiClient(testConfig({ OPENAI_API_KEY: 'sk-test', AI_ENABLED: 'false' })),
    ).toBeNull();
    expect(createAiClient(testConfig())).toBeNull();
  });

  it('sends the spec’s system prompt, the model, a strict JSON schema, and keeps nothing on OpenAI’s side', async () => {
    const create = vi.fn<CreateResponse>().mockResolvedValue(reply('{"a":1}'));
    const result = await client(create).structured(request);
    expect(result).toMatchObject({ ok: true, data: { a: 1 }, tokens: 42 });
    const [body, options] = create.mock.calls[0]!;
    expect(body).toMatchObject({
      model: 'test-model',
      instructions: SYSTEM_PROMPT,
      reasoning: { effort: 'none' },
      temperature: 0.2,
      store: false,
      text: { format: { type: 'json_schema', name: 'interpret', strict: true } },
    });
    expect(options.timeout).toBe(10_000);
    expect(body.input).toEqual([
      { role: 'developer', content: 'Do the task.' },
      { role: 'user', content: '{"visitor_text":"hello"}' },
    ]);
  });

  it('uses the spec’s system prompt word for word (compared with docs/SPEC.md itself)', async () => {
    const spec = await readFile(new URL('../../docs/SPEC.md', import.meta.url), 'utf8');
    const line = spec.split('\n').find((text) => text.startsWith('"You are the assistant for the'));
    expect(line, 'the prompt line in docs/SPEC.md').toBeDefined();
    expect(SYSTEM_PROMPT).toBe(JSON.parse(line!) as string);
  });

  it('retries once after a timeout, then succeeds', async () => {
    const create = vi
      .fn<CreateResponse>()
      .mockRejectedValueOnce(new APIConnectionTimeoutError())
      .mockResolvedValueOnce(reply('{"a":2}'));
    expect(await client(create).structured(request)).toMatchObject({ ok: true, data: { a: 2 } });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry', async () => {
    const create = vi.fn<CreateResponse>().mockRejectedValue(new APIConnectionTimeoutError());
    expect(await client(create).structured(request)).toMatchObject({ ok: false, error: 'timeout' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries a server error once', async () => {
    const create = vi
      .fn<CreateResponse>()
      .mockRejectedValue(apiError(503, { message: 'overloaded' }));
    expect(await client(create).structured(request)).toMatchObject({
      ok: false,
      error: 'server_error',
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a rejected key, a missing model or a rate limit', async () => {
    for (const [status, body, code] of [
      [401, { message: 'Incorrect API key sk-test', code: 'invalid_api_key' }, 'auth'],
      [
        404,
        { message: 'The model `test-model` does not exist', code: 'model_not_found' },
        'model_not_found',
      ],
      [429, { message: 'Too many requests', code: 'rate_limit_exceeded' }, 'rate_limited'],
    ] as const) {
      const create = vi.fn<CreateResponse>().mockRejectedValue(apiError(status, body));
      expect(await client(create).structured(request)).toMatchObject({ ok: false, error: code });
      expect(create).toHaveBeenCalledTimes(1);
    }
  });

  it('says clearly in the log when the model is not available (so the owner can fix OPENAI_MODEL)', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => void logged.push(String(line)));
    const create = vi.fn<CreateResponse>().mockRejectedValue(
      apiError(404, {
        message: 'The model `test-model` does not exist',
        code: 'model_not_found',
      }),
    );
    await client(create).structured(request);
    const line = logged.join('\n');
    expect(line).toContain('ai_failed');
    expect(line).toContain('model_not_found');
    expect(line).toContain('Check OPENAI_MODEL');
  });

  it('says clearly in the log when the account has no credit', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => void logged.push(String(line)));
    const create = vi
      .fn<CreateResponse>()
      .mockRejectedValue(
        apiError(429, { message: 'You exceeded your current quota', code: 'insufficient_quota' }),
      );
    await client(create).structured(request);
    expect(logged.join('\n')).toContain('billing');
  });

  it('never puts the API key or the visitor’s text in the log', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => void logged.push(String(line)));
    vi.spyOn(console, 'log').mockImplementation((line) => void logged.push(String(line)));
    const create = vi
      .fn<CreateResponse>()
      .mockRejectedValue(apiError(401, { message: 'Incorrect API key provided: sk-test' }));
    await client(create).structured({
      ...request,
      input: { task: 't', data: { visitor_text: 'my secret story' } },
    });
    expect(logged.join('\n')).not.toContain('sk-test');
    expect(logged.join('\n')).not.toContain('secret story');
  });

  it('leaves out a parameter the model rejects, and remembers that for later calls', async () => {
    const create = vi
      .fn<CreateResponse>()
      .mockRejectedValueOnce(
        apiError(400, {
          message: "Unsupported parameter: 'temperature' is not supported with this model.",
          param: 'temperature',
        }),
      )
      .mockResolvedValue(reply('{"a":3}'));
    const ai = client(create);
    expect(await ai.structured(request)).toMatchObject({ ok: true, data: { a: 3 } });
    expect(create.mock.calls[0]![0]).toHaveProperty('temperature');
    expect(create.mock.calls[1]![0]).not.toHaveProperty('temperature');
    await ai.structured(request);
    expect(create.mock.calls[2]![0]).not.toHaveProperty('temperature');
    expect(create.mock.calls[2]![0]).toHaveProperty('reasoning');
  });

  it('also drops reasoning if that is what the model rejects', async () => {
    const create = vi
      .fn<CreateResponse>()
      .mockRejectedValueOnce(
        apiError(400, { message: 'Unsupported value', param: 'reasoning.effort' }),
      )
      .mockResolvedValue(reply('{"a":4}'));
    await client(create).structured(request);
    expect(create.mock.calls[1]![0]).not.toHaveProperty('reasoning');
  });

  it.each([
    ['not JSON', 'sorry I cannot', 'bad_output'],
    ['an empty reply', '', 'bad_output'],
    ['JSON that is not an object', '[1,2]', 'bad_output'],
  ])('treats %s as a failed call', async (_name, text, code) => {
    const create = vi.fn<CreateResponse>().mockResolvedValue(reply(text));
    expect(await client(create).structured(request)).toMatchObject({ ok: false, error: code });
  });

  it('treats an answer that was cut off as a failed call', async () => {
    const create = vi
      .fn<CreateResponse>()
      .mockResolvedValue({ status: 'incomplete', output_text: '{"a":' });
    expect(await client(create).structured(request)).toMatchObject({
      ok: false,
      error: 'bad_output',
    });
  });

  it('never throws', async () => {
    const create = vi.fn<CreateResponse>().mockRejectedValue(new TypeError('boom'));
    expect(await client(create).structured(request)).toMatchObject({ ok: false });
  });
});

describe('scrubContactDetails (rule 2: no names, emails or phone numbers go to OpenAI)', () => {
  it.each([
    ['jane.doe+adn@example.co.uk', '[email]'],
    ['reach me at (404) 555-1234 please', '[phone]'],
    ['+1 404 555 1234', '[phone]'],
    ['404.555.1234', '[phone]'],
    ['jane dot doe at gmail dot com', '[email]'],
    ['my name is Jane Smith', '[name]'],
  ])('replaces the contact details in %j', (text, marker) => {
    const clean = scrubContactDetails(text);
    expect(clean).toContain(marker);
    expect(clean).not.toMatch(/jane|404|555|smith/i);
  });

  it('keeps ZIP codes, years and dates, which help find a county', () => {
    expect(
      scrubContactDetails('I live near 30060 and married in 2015, divorce filed 10-12-2023'),
    ).toBe('I live near 30060 and married in 2015, divorce filed 10-12-2023');
    expect(scrubContactDetails('ZIP 30060-1234')).toBe('ZIP 30060-1234');
  });
});

describe('limitWords and matchKey', () => {
  it('keeps short text and cuts long text at a sentence, or with an ellipsis', () => {
    expect(limitWords('One two three.', 5)).toBe('One two three.');
    expect(limitWords('One two three. Four five six seven.', 5)).toBe('One two three.');
    expect(limitWords('one two three four five six seven', 4)).toBe('one two three four…');
  });

  it('compares names ignoring case, accents, spaces and punctuation', () => {
    expect(matchKey('Doña Ana County')).toBe('donaanacounty');
    expect(matchKey("I'm not sure")).toBe('imnotsure');
    expect(matchKey('not_sure')).toBe('notsure');
  });
});
