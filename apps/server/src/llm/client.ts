import { Agent, request } from 'undici';
import {
  llmParametersSchema,
  llmReady,
  type LlmParameters,
  type LlmSettingsPublic,
} from '@vital/dto';
import { config } from '../config.js';
import type { User } from '../db/schema.js';
import { AppError } from '../errors.js';
import { assertSafeUrl } from '../extract/ssrf.js';
import { logger } from '../utils/logger.js';
import { decryptSecret } from './crypto.js';

const COMPLETE_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 60_000;

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmCompleteInput = {
  apiBase: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  json?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  parameters?: LlmParameters;
};

export interface LlmTransport {
  complete(input: LlmCompleteInput): Promise<string>;
}

const agent = new Agent({ connect: { timeout: 10_000 } });

export function completionsUrl(apiBase: string): string {
  const root = apiBase.replace(/\/$/, '');
  if (root.endsWith('/chat/completions')) return root;
  return `${root}/chat/completions`;
}

export function assertLlmApiBase(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (config.NODE_ENV === 'production') {
    if (url.protocol !== 'https:') throw AppError.of(400, 'VALIDATION_ERROR');
    assertSafeUrl(url);
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function contentOf(json: unknown): string | null {
  if (!isRecord(json) || !Array.isArray(json.choices)) return null;
  const first: unknown = json.choices[0];
  if (!isRecord(first)) return null;
  if (first.finish_reason === 'length') throw AppError.of(502, 'LLM_OUTPUT_TRUNCATED');
  const message: unknown = first.message;
  if (!isRecord(message)) return null;
  return typeof message.content === 'string' ? message.content : null;
}

const defaultTransport: LlmTransport = {
  async complete(input) {
    const url = completionsUrl(input.apiBase);
    const body: Record<string, unknown> = {
      ...input.parameters,
      model: input.model,
      messages: input.messages,
    };
    if (input.json) body.response_format = { type: 'json_object' };
    if (
      body.max_tokens === undefined &&
      body.max_completion_tokens === undefined &&
      input.maxTokens !== undefined
    ) {
      body.max_tokens = input.maxTokens;
    }
    const res = await request(url, {
      method: 'POST',
      dispatcher: agent,
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? COMPLETE_TIMEOUT_MS),
    });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      logger.warn('llm.http.fail', { status: res.statusCode });
      throw AppError.of(502, 'LLM_UNAVAILABLE');
    }
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw AppError.of(502, 'LLM_UNAVAILABLE');
    }
    const content = contentOf(json);
    if (content === null || content.trim() === '') {
      throw AppError.of(502, 'LLM_UNAVAILABLE');
    }
    return content;
  },
};

let transport: LlmTransport = defaultTransport;

/** Test seam. Do not call from product code. */
export function setLlmTransport(next: LlmTransport | null): void {
  transport = next ?? defaultTransport;
}

export function llmPublicOf(user: User): LlmSettingsPublic {
  return {
    apiBase: user.llmApiBase,
    model: user.llmModel,
    apiKeySet: user.llmApiKey !== null && user.llmApiKey !== '',
    parameters: user.llmParameters,
  };
}

export function llmCredentialsOf(
  user: User,
): { apiBase: string; apiKey: string; model: string; parameters: LlmParameters } | null {
  const pub = llmPublicOf(user);
  if (!llmReady(pub) || user.llmApiKey === null) return null;
  const apiKey = decryptSecret(user.llmApiKey);
  if (apiKey === null || apiKey === '') throw AppError.of(400, 'LLM_NOT_CONFIGURED');
  if (pub.apiBase === null || pub.model === null) return null;
  return { apiBase: pub.apiBase, apiKey, model: pub.model, parameters: user.llmParameters };
}

export async function completeChat(input: LlmCompleteInput): Promise<string> {
  assertLlmApiBase(input.apiBase);
  if (!llmParametersSchema.safeParse(input.parameters ?? {}).success) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  try {
    return await transport.complete(input);
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw AppError.of(504, 'LLM_TIMEOUT');
    }
    throw err;
  }
}

export async function testLlmConnection(user: User): Promise<{ ok: true }> {
  const creds = llmCredentialsOf(user);
  if (!creds) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
  await completeChat({
    ...creds,
    messages: [{ role: 'user', content: 'Reply with only: pong' }],
    json: false,
    timeoutMs: TEST_TIMEOUT_MS,
    maxTokens: 1024,
  });
  return { ok: true };
}
