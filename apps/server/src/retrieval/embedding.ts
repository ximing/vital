import { ensure2xx, requestJson, RetrievalError } from './http.js';
import { withRetrievalTelemetry } from './telemetry.js';

export interface EmbeddingClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  timeoutMs?: number;
}

export interface EmbeddingClient {
  embedTexts(texts: string[], opts?: { userId?: string }): Promise<number[][]>;
}

/** DashScope multimodal-embedding caps one request at 20 content items. */
const MAX_BATCH_SIZE = 20;

function asNumberVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const vector: number[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'number') return null;
    vector.push(item);
  }
  return vector;
}

interface ParsedEmbeddingResponse {
  vectors: number[][];
  promptTokens: number;
}

// Verified against a live call (2026-09): output.embeddings[] carries
// {embedding: number[], index, type}, usage carries input_tokens/total_tokens.
function parseEmbeddingResponse(json: unknown, expectedCount: number): ParsedEmbeddingResponse {
  const root = json as { output?: { embeddings?: unknown }; usage?: unknown };
  const embeddings = root.output?.embeddings;
  if (!Array.isArray(embeddings)) {
    throw new RetrievalError('BAD_RESPONSE', 'embedding response missing output.embeddings');
  }
  const rows = (embeddings as unknown[]).map((item, position) => {
    const record = item as { index?: unknown; embedding?: unknown };
    const vector = asNumberVector(record.embedding);
    if (vector === null) {
      throw new RetrievalError('BAD_RESPONSE', 'embedding item missing numeric embedding vector');
    }
    return { index: typeof record.index === 'number' ? record.index : position, vector };
  });
  if (rows.length !== expectedCount) {
    throw new RetrievalError(
      'BAD_RESPONSE',
      `embedding count mismatch: expected ${String(expectedCount)}, got ${String(rows.length)}`,
    );
  }
  rows.sort((a, b) => a.index - b.index);
  const usage = root.usage as { input_tokens?: unknown; total_tokens?: unknown } | undefined;
  const promptTokens =
    typeof usage?.input_tokens === 'number'
      ? usage.input_tokens
      : typeof usage?.total_tokens === 'number'
        ? usage.total_tokens
        : 0;
  return { vectors: rows.map((row) => row.vector), promptTokens };
}

/** 百炼多模态独立向量（纯文本用法），按输入顺序返回向量。 */
export function createEmbeddingClient(options: EmbeddingClientOptions): EmbeddingClient {
  const url = `${options.baseUrl.replace(/\/$/, '')}/services/embeddings/multimodal-embedding/multimodal-embedding`;

  async function embedBatch(texts: string[]): Promise<ParsedEmbeddingResponse> {
    const res = await requestJson('POST', url, {
      timeoutMs: options.timeoutMs,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      },
      body: {
        model: options.model,
        input: { contents: texts.map((text) => ({ text })) },
        parameters: { dimension: options.dimensions },
      },
    });
    ensure2xx(res, 'dashscope embedding');
    return parseEmbeddingResponse(res.json, texts.length);
  }

  return {
    async embedTexts(texts, opts) {
      if (texts.length === 0) return [];
      return withRetrievalTelemetry(
        { userId: opts?.userId, capability: 'agent.embed', model: options.model },
        async () => {
          const vectors: number[][] = [];
          let promptTokens = 0;
          for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
            const batch = await embedBatch(texts.slice(start, start + MAX_BATCH_SIZE));
            vectors.push(...batch.vectors);
            promptTokens += batch.promptTokens;
          }
          return { result: vectors, promptTokens };
        },
      );
    },
  };
}
