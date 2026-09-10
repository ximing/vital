import { ensure2xx, requestJson, RetrievalError } from './http.js';
import { withRetrievalTelemetry } from './telemetry.js';

export interface RerankClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

export interface RerankResult {
  index: number;
  score: number;
}

export interface RerankClient {
  rerankTexts(
    query: string,
    documents: string[],
    topN: number,
    opts?: { userId?: string },
  ): Promise<RerankResult[]>;
}

interface ParsedRerankResponse {
  results: RerankResult[];
  promptTokens: number;
}

// Verified against a live call (2026-09): output.results[] carries
// {index, relevance_score}, usage carries prompt_tokens/total_tokens.
function parseRerankResponse(json: unknown): ParsedRerankResponse {
  const root = json as { output?: { results?: unknown }; usage?: unknown };
  const results = root.output?.results;
  if (!Array.isArray(results)) {
    throw new RetrievalError('BAD_RESPONSE', 'rerank response missing output.results');
  }
  const parsed = (results as unknown[]).map((item) => {
    const record = item as { index?: unknown; relevance_score?: unknown };
    if (typeof record.index !== 'number' || typeof record.relevance_score !== 'number') {
      throw new RetrievalError('BAD_RESPONSE', 'rerank result missing index / relevance_score');
    }
    return { index: record.index, score: record.relevance_score };
  });
  const usage = root.usage as { total_tokens?: unknown } | undefined;
  const promptTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : 0;
  return { results: parsed, promptTokens };
}

/** 百炼 text-rerank：对候选文档按 query 相关性精排。 */
export function createRerankClient(options: RerankClientOptions): RerankClient {
  const url = `${options.baseUrl.replace(/\/$/, '')}/services/rerank/text-rerank/text-rerank`;

  return {
    async rerankTexts(query, documents, topN, opts) {
      if (documents.length === 0) return [];
      return withRetrievalTelemetry(
        { userId: opts?.userId, capability: 'agent.rerank', model: options.model },
        async () => {
          const res = await requestJson('POST', url, {
            timeoutMs: options.timeoutMs,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${options.apiKey}`,
            },
            body: {
              model: options.model,
              input: { query, documents },
              parameters: { top_n: topN, return_documents: false },
            },
          });
          ensure2xx(res, 'dashscope rerank');
          const parsed = parseRerankResponse(res.json);
          return { result: parsed.results, promptTokens: parsed.promptTokens };
        },
      );
    },
  };
}
