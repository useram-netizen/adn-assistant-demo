import type { AiClient, StructuredRequest, StructuredResult } from '../../src/ai/client.js';

export interface FakeAi extends AiClient {
  /** Every request the AI would have received. */
  calls: StructuredRequest[];
}

/** An AI client that answers from a function and records what it was sent. */
export function fakeAi(
  answer: (request: StructuredRequest) => StructuredResult | Promise<StructuredResult>,
): FakeAi {
  const calls: StructuredRequest[] = [];
  return {
    model: 'fake-model',
    calls,
    async structured(request) {
      calls.push(request);
      return answer(request);
    },
  };
}

export const ok = (data: unknown): StructuredResult => ({ ok: true, data, ms: 5, tokens: 10 });
export const failed = (): StructuredResult => ({ ok: false, error: 'timeout', ms: 5, tokens: 0 });
