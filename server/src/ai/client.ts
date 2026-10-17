import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import type { Config } from '../config/env.js';
import { log, redact } from '../lib/log.js';
import type { EventDataByType } from '../shared/api.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

/**
 * The OpenAI client: one structured call (Responses API + Structured Outputs) with the spec's
 * timeout and single retry. It never throws and never logs the text it sends or receives.
 */

export type AiCallKind = EventDataByType['ai_call']['kind'];

export type AiErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'auth'
  | 'model_not_found'
  | 'bad_request'
  | 'bad_output'
  | 'network'
  | 'server_error';

/** A JSON schema for Structured Outputs in strict mode (see calls.ts). */
export type JsonSchema = Record<string, unknown>;

export interface StructuredRequest {
  kind: AiCallKind;
  /** Names the output format (letters, digits, "_" and "-"). */
  schemaName: string;
  schema: JsonSchema;
  input: {
    /** What to do, sent as a developer message (the system prompt stays the spec's text). */
    task: string;
    /** The call's data, sent as JSON in the user message. Visitor text must be scrubbed. */
    data: Record<string, unknown>;
  };
}

export type StructuredResult =
  | { ok: true; data: unknown; ms: number; tokens: number }
  | { ok: false; error: AiErrorCode; ms: number; tokens: number };

/** What the AI calls need. Easy to fake in tests: implement `structured`. */
export interface AiClient {
  readonly model: string;
  structured(request: StructuredRequest): Promise<StructuredResult>;
}

/** The parts of a Responses API reply that the client reads. */
export interface ResponseLike {
  status?: string | null;
  output_text?: unknown;
  usage?: { total_tokens?: number | null } | null;
}

/** Sends one request (the OpenAI SDK by default; tests pass a fake). Throws the SDK's errors. */
export type CreateResponse = (
  body: ResponseCreateParamsNonStreaming,
  options: { timeout: number },
) => Promise<ResponseLike>;

export interface AiClientOptions {
  createResponse?: CreateResponse;
  /** Wait before retrying a 5xx or network error. */
  retryDelayMs?: number;
  now?: () => number;
}

/** Optional request parameters a model may reject (gpt-6-luna takes both). */
type DroppableParam = 'reasoning' | 'temperature';

const TEMPERATURE = 0.2;
/** Replies are short JSON objects; this only stops a runaway answer. */
const MAX_OUTPUT_TOKENS = 1000;
/** Retries after a timeout, 5xx or network error (spec: one retry). */
const TRANSIENT_RETRIES = 1;
const TRANSIENT_ERRORS: ReadonlySet<AiErrorCode> = new Set(['timeout', 'network', 'server_error']);

/** Null when the AI is off (AI_ENABLED=false) or there is no OPENAI_API_KEY. */
export function createAiClient(config: Config, options: AiClientOptions = {}): AiClient | null {
  const { apiKey } = config.ai;
  if (!config.ai.available || !apiKey) return null;
  const createResponse = options.createResponse ?? sdkCreateResponse(config, apiKey);
  return new OpenAiClient(config, createResponse, options);
}

function sdkCreateResponse(config: Config, apiKey: string): CreateResponse {
  const openai = new OpenAI({
    apiKey,
    // null, not undefined: the SDK would otherwise read OPENAI_BASE_URL itself.
    baseURL: config.ai.baseUrl ?? null,
    timeout: config.ai.timeoutMs,
    // The spec's single retry is done here, so it is counted and logged.
    maxRetries: 0,
    // OPENAI_LOG=debug would make the SDK print request bodies (visitor text): keep it at warn,
    // and pass its messages through redact().
    logLevel: 'warn',
    logger: {
      error: (message: unknown) => log.warn('ai_sdk', { detail: redact(String(message)) }),
      warn: (message: unknown) => log.warn('ai_sdk', { detail: redact(String(message)) }),
      info: () => {},
      debug: () => {},
    },
  });
  return (body, requestOptions) => openai.responses.create(body, requestOptions);
}

class OpenAiClient implements AiClient {
  readonly model: string;
  /** Parameters the model rejected, remembered so later calls skip them. */
  private readonly unsupported = new Set<DroppableParam>();
  private readonly retryDelayMs: number;
  private readonly now: () => number;

  constructor(
    private readonly config: Config,
    private readonly createResponse: CreateResponse,
    options: AiClientOptions,
  ) {
    this.model = config.ai.model;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.now = options.now ?? Date.now;
  }

  async structured(request: StructuredRequest): Promise<StructuredResult> {
    const started = this.now();
    let attempts = 0;
    let retries = 0;
    for (;;) {
      attempts += 1;
      const body = this.body(request);
      let response: ResponseLike;
      try {
        response = await this.createResponse(body, { timeout: this.config.ai.timeoutMs });
      } catch (error) {
        // Each parameter can be dropped once per call, so this loop always ends.
        const param = unsupportedParam(error);
        if (param && param in body) {
          this.markUnsupported(param);
          continue;
        }
        const failure = describeError(error);
        if (TRANSIENT_ERRORS.has(failure.code) && retries < TRANSIENT_RETRIES) {
          retries += 1;
          if (failure.code !== 'timeout') await sleep(this.retryDelayMs);
          continue;
        }
        return this.fail(request.kind, failure, { started, attempts, tokens: 0 });
      }

      const tokens = totalTokens(response);
      const output = readOutput(response);
      if (!output.ok) {
        const failure: FailureInfo = { code: 'bad_output', reason: output.reason };
        return this.fail(request.kind, failure, { started, attempts, tokens });
      }
      const ms = this.now() - started;
      log.info('ai_call', {
        kind: request.kind,
        model: this.model,
        ok: true,
        ms,
        tokens,
        attempts,
      });
      return { ok: true, data: output.data, ms, tokens };
    }
  }

  /** Remembers (for this model) that a parameter is rejected, and says so once in the log. */
  private markUnsupported(param: DroppableParam): void {
    if (this.unsupported.has(param)) return;
    this.unsupported.add(param);
    log.warn('ai_param_unsupported', { model: this.model, param });
  }

  private body(request: StructuredRequest): ResponseCreateParamsNonStreaming {
    return {
      model: this.model,
      instructions: SYSTEM_PROMPT,
      input: [
        { role: 'developer', content: request.input.task },
        { role: 'user', content: JSON.stringify(request.input.data) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: request.schemaName,
          schema: request.schema,
          strict: true,
        },
      },
      ...(this.unsupported.has('reasoning') ? {} : { reasoning: { effort: 'none' } }),
      ...(this.unsupported.has('temperature') ? {} : { temperature: TEMPERATURE }),
      max_output_tokens: MAX_OUTPUT_TOKENS,
      // Don't keep the conversation on OpenAI's side (STORE_TRANSCRIPTS=false).
      store: false,
    };
  }

  private fail(
    kind: AiCallKind,
    failure: FailureInfo,
    { started, attempts, tokens }: { started: number; attempts: number; tokens: number },
  ): StructuredResult {
    const ms = this.now() - started;
    const fields = {
      kind,
      model: this.model,
      ok: false,
      code: failure.code,
      status: failure.status,
      apiCode: failure.apiCode,
      reason: failure.reason,
      detail: failure.detail,
      ms,
      attempts,
    };
    const hint = loudHint(failure, this.model);
    if (hint) log.error('ai_failed', { ...fields, hint });
    else log.warn('ai_failed', fields);
    return { ok: false, error: failure.code, ms, tokens };
  }
}

// ---------------------------------------------------------------- Errors

interface FailureInfo {
  code: AiErrorCode;
  /** HTTP status from OpenAI, when there was a response. */
  status?: number;
  /** OpenAI's error code, for example "model_not_found" or "insufficient_quota". */
  apiCode?: string;
  /** Why the output was unusable (bad_output). */
  reason?: string;
  /** OpenAI's error message, redacted and shortened (never for auth errors: it quotes the key). */
  detail?: string;
}

/** Sorts an error from the SDK into one of the codes the rest of the app understands. */
export function classifyAiError(error: unknown): AiErrorCode {
  return describeError(error).code;
}

function describeError(error: unknown): FailureInfo {
  // The connection errors extend APIError, so check them first.
  if (error instanceof APIConnectionTimeoutError) return { code: 'timeout' };
  if (error instanceof APIUserAbortError) return { code: 'timeout' };
  if (error instanceof APIConnectionError) return { code: 'network' };
  if (error instanceof APIError) {
    const status = typeof error.status === 'number' ? error.status : undefined;
    const apiCode = typeof error.code === 'string' ? error.code : undefined;
    const code = statusCode(status, apiCode);
    const detail = code === 'auth' ? undefined : redact(error.message).slice(0, 300);
    return { code, status, apiCode, detail };
  }
  // Anything else was thrown while reading the reply (for example a malformed body).
  return { code: 'bad_output', reason: error instanceof Error ? error.name : 'unknown' };
}

function statusCode(status: number | undefined, apiCode: string | undefined): AiErrorCode {
  if (apiCode === 'model_not_found' || status === 404) return 'model_not_found';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 408) return 'timeout';
  if (status === 409 || (status !== undefined && status >= 500)) return 'server_error';
  return 'bad_request';
}

/** Failures the owner must fix in the settings or the OpenAI account: logged as errors. */
function loudHint(failure: FailureInfo, model: string): string | undefined {
  if (failure.code === 'model_not_found') {
    return `OpenAI does not know the model "${model}", or this key cannot use it. Check OPENAI_MODEL.`;
  }
  if (failure.code === 'auth') {
    return 'OpenAI rejected the API key. Check OPENAI_API_KEY (and that the key can use this model).';
  }
  if (failure.code === 'rate_limited' && failure.apiCode === 'insufficient_quota') {
    return 'The OpenAI account has no credit left (insufficient_quota). Check billing in the OpenAI dashboard.';
  }
  return undefined;
}

/** A 400 that names a parameter the model doesn't support, which we can leave out. */
function unsupportedParam(error: unknown): DroppableParam | null {
  if (!(error instanceof APIError) || error.status !== 400) return null;
  const named =
    typeof error.param === 'string' && error.param
      ? error.param
      : /unsupported (?:parameter|value):\s*'([\w.]+)'/i.exec(error.message)?.[1];
  if (named === 'temperature') return 'temperature';
  if (named === 'reasoning' || named?.startsWith('reasoning.')) return 'reasoning';
  return null;
}

// ---------------------------------------------------------------- Replies

function readOutput(
  response: ResponseLike,
): { ok: true; data: Record<string, unknown> } | { ok: false; reason: string } {
  // "incomplete" means the answer was cut off (output limit or content filter).
  if (response.status && response.status !== 'completed') {
    return { ok: false, reason: `status_${response.status}` };
  }
  const text = response.output_text;
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty' };
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      return { ok: true, data: data as Record<string, unknown> };
    }
    return { ok: false, reason: 'not_an_object' };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

function totalTokens(response: ResponseLike): number {
  const tokens = response.usage?.total_tokens;
  return typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
