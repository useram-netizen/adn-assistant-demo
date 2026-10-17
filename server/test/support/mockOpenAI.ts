import { createServer, type IncomingMessage, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';

/**
 * A stand-in for the OpenAI Responses API, for end-to-end tests: POST /v1/responses answers from
 * the visitor's text with fixed, sensible replies, and GET /v1/models/<id> says the model exists.
 * It reads what the server sends (the schema name, and the JSON data in the user message), so it
 * only ever picks an option the step really offers, like a well-behaved model.
 *
 * Run it on its own: npx tsx server/test/support/mockOpenAI.ts --port 4399
 */

interface Data {
  step?: string;
  visitor_text?: string;
  options?: Array<{ id: string }>;
  counties?: Array<{ fips: string }>;
}

const has = (text: string, ...words: string[]) => words.every((word) => text.includes(word));

function interpret(data: Data) {
  const text = (data.visitor_text ?? '').toLowerCase();
  const ids = new Set((data.options ?? []).map((option) => option.id));
  const pick = (id: string, extra: Record<string, unknown> = {}) =>
    ids.has(id)
      ? {
          kind: 'option',
          option_id: id,
          reply: '',
          safety_concern: false,
          shares_situation: false,
          ...extra,
        }
      : null;
  const question = (reply: string) => ({
    kind: 'question',
    option_id: null,
    reply,
    safety_concern: false,
    shares_situation: false,
  });

  if (text.includes('atlanta')) return pick('GA');
  if (text.includes('london')) return pick('uk');
  if (has(text, 'mediator', 'join')) return pick('professional');
  if (has(text, 'hits me')) {
    return pick('divorce', {
      reply: 'I’m so sorry you’re facing this. Your safety matters.',
      safety_concern: true,
      shares_situation: true,
    });
  }
  if (has(text, 'husband', 'split')) {
    return pick('divorce', {
      reply: 'I’m sorry you’re going through this.',
      shares_situation: true,
    });
  }
  if (text.includes('cdfa')) {
    return question(
      'A CDFA is a financial professional who helps people understand the money side of divorce.',
    );
  }
  if (text.includes('custody')) {
    return question(
      'I can’t advise you on what to request. A divorce attorney can help with custody questions.',
    );
  }
  if (text.includes('not sure') || text.includes('don’t know')) return pick('not_sure');
  return {
    kind: 'unclear',
    option_id: null,
    reply: '',
    safety_concern: false,
    shares_situation: false,
  };
}

function countyFromPlace(data: Data) {
  const text = (data.visitor_text ?? '').toLowerCase();
  const fips = text.includes('marietta') ? '13067' : null;
  const known = (data.counties ?? []).some((county) => county.fips === fips);
  return {
    county_fips: known ? fips : null,
    confidence: known ? 'high' : 'low',
    reply: '',
    safety_concern: false,
  };
}

function situation(data: Data) {
  const text = (data.visitor_text ?? '').toLowerCase();
  const suggested = has(text, 'agree')
    ? ['mediator', 'attorney']
    : text.includes('kids') || text.includes('civil')
      ? ['mediator', 'therapist', 'coach']
      : [];
  return {
    reply: 'Thank you for sharing that. It sounds like a lot.',
    suggested_categories: suggested,
    summary: `They said: ${data.visitor_text ?? ''}`.slice(0, 200),
    safety_concern: text.includes('hits me'),
  };
}

function recommend() {
  return {
    recommendations: [
      { category: 'mediator', reason: 'Helps you agree on terms together' },
      { category: 'coach', reason: 'Supports your next steps' },
      { category: 'therapist', reason: 'Supports you through the changes' },
    ],
    reply: 'These could help.',
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

export interface MockOpenAI {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export function startMockOpenAI({ port = 0 }: { port?: number } = {}): Promise<MockOpenAI> {
  const server = createServer((request, response) => {
    void (async () => {
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      const url = request.url ?? '';
      if (request.method === 'GET' && url.startsWith('/v1/models/')) {
        return send(200, { id: decodeURIComponent(url.split('/').pop() ?? ''), object: 'model' });
      }
      if (request.method === 'POST' && url.startsWith('/v1/responses')) {
        const body = await readJson(request);
        const format = (body.text as { format?: { name?: string } } | undefined)?.format;
        const input = body.input as Array<{ role: string; content: string }> | undefined;
        const user = input?.find((message) => message.role === 'user')?.content ?? '{}';
        const data = JSON.parse(user) as Data;
        const out =
          format?.name === 'interpret'
            ? interpret(data)
            : format?.name === 'county_from_place'
              ? countyFromPlace(data)
              : format?.name === 'situation'
                ? situation(data)
                : format?.name === 'recommend_categories'
                  ? recommend()
                  : null;
        if (!out)
          return send(400, { error: { message: 'unknown schema', code: 'invalid_request' } });
        // The shape of a real Responses API reply: the SDK reads the text from `output`.
        return send(200, {
          id: 'resp_mock',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              id: 'msg_mock',
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'output_text', text: JSON.stringify(out), annotations: [] }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        });
      }
      return send(404, { error: { message: 'not found', code: 'not_found' } });
    })().catch(() => {
      response.writeHead(500).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${actual}/v1`,
        server,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// Run directly: npx tsx server/test/support/mockOpenAI.ts --port 4399
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--port');
  const port = index >= 0 ? Number(process.argv[index + 1]) : 4399;
  const mock = await startMockOpenAI({ port });
  console.log(`mock OpenAI ready at ${mock.url}`);
}
