import {
  contentText,
  getSupportedThinkingLevels,
  type SimpleStreamOptions,
  type ThinkingLevel,
  createModels,
  createProvider,
  type Api,
  type Context,
  type Model,
  type MutableModels,
  type Provider,
  type Usage,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { groqProvider } from '@earendil-works/pi-ai/providers/groq';
import { mistralProvider } from '@earendil-works/pi-ai/providers/mistral';
import { moonshotaiProvider } from '@earendil-works/pi-ai/providers/moonshotai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import type { LlmCapability, LlmCatalogProvider, LlmParameters, LlmRouteTarget } from '@vital/dto';
import { AppError } from '../errors.js';
import type { StoredLlmProvider, User } from '../db/schema.js';
import { completeModel } from './model-transport.js';
import { executionContext, skipExecution, withExecution } from '../agent/executions.service.js';
import { decryptSecret } from './crypto.js';

const COMPLETE_TIMEOUT_MS = 60_000;

const BUILTIN_FACTORIES: Record<string, () => Provider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  deepseek: deepseekProvider,
  moonshot: moonshotaiProvider,
  openrouter: openrouterProvider,
  groq: groqProvider,
  mistral: mistralProvider,
  xai: xaiProvider,
  zhipu: () => {
    const source = zaiProvider();
    const baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
    return createProvider({
      id: 'zhipu',
      name: '智谱',
      baseUrl,
      auth: source.auth,
      models: source.getModels().map((model) => ({ ...model, provider: 'zhipu', baseUrl })),
      api: openAICompletionsApi(),
    });
  },
};

export const BUILTIN_PROVIDER_IDS = Object.keys(BUILTIN_FACTORIES);

/** Catalog for the settings UI: builtin provider id → label + selectable models. */
export function llmCatalog(): LlmCatalogProvider[] {
  return Object.entries(BUILTIN_FACTORIES).map(([id, factory]) => {
    const provider = factory();
    return {
      id,
      name: provider.name,
      models: provider.getModels().map((m) => ({
        id: m.id,
        name: m.name,
        api: m.api,
        reasoning: m.reasoning,
        thinkingLevels: getSupportedThinkingLevels(m),
      })),
    };
  });
}

function customModel(stored: StoredLlmProvider, modelId: string): Model<'openai-completions'> {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: stored.id,
    baseUrl: stored.baseUrl ?? '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

export interface ResolvedModel {
  models: MutableModels;
  model: Model<Api>;
  apiKey: string;
  route: LlmRouteTarget;
  stored: StoredLlmProvider;
}

function buildProvider(stored: StoredLlmProvider): Provider {
  const factory = BUILTIN_FACTORIES[stored.providerId];
  if (factory) {
    const provider = factory();
    const known = provider.getModels();
    const template = known[0];
    if (!template) return provider;
    const extra = stored.models.filter((id) => !known.some((model) => model.id === id));
    return {
      ...provider,
      getModels: () => [
        ...known,
        ...extra.map((id) => ({
          ...template,
          id,
          name: id,
          provider: provider.id,
          baseUrl: provider.baseUrl ?? template.baseUrl,
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      ],
    };
  }
  return createProvider({
    id: stored.id,
    name: stored.label,
    ...(stored.baseUrl !== undefined ? { baseUrl: stored.baseUrl } : {}),
    auth: { apiKey: { name: stored.label, resolve: () => Promise.resolve({ auth: {} }) } },
    models: stored.models.map((id) => customModel(stored, id)),
    api: openAICompletionsApi(),
  });
}

/** Test seam. Do not call from product code. */
export type PiResolveOverride = (
  stored: StoredLlmProvider,
  route: LlmRouteTarget,
  apiKey: string,
) => ResolvedModel | null;
let resolveOverride: PiResolveOverride | null = null;
export function setPiResolveOverride(next: PiResolveOverride | null): void {
  resolveOverride = next;
}

/** Resolve the model for a capability from the user's providers + routing. null = not configured. */
export function resolveModelFor(user: User, capability: LlmCapability): ResolvedModel | null {
  const selectedRoute = user.llmRouting[capability] ?? user.llmRouting.default;
  const route = selectedRoute ? { ...selectedRoute } : null;
  if (!route) return null;
  const stored = user.llmProviders.find((item) => item.id === route.providerId);
  if (!stored || !stored.models.includes(route.model)) return null;
  route.parameters = { ...stored.modelParameters?.[route.model], ...route.parameters };
  const apiKey = decryptSecret(stored.apiKeyEnc);
  if (!apiKey) return null;
  if (resolveOverride) return resolveOverride(stored, route, apiKey);

  const provider = buildProvider(stored);
  const piProviderId = provider.id;
  const model = provider.getModels().find((m) => m.id === route.model);
  if (!model) return null;

  const models = createModels();
  models.setProvider(provider);
  const found = models.getModel(piProviderId, route.model);
  if (!found) return null;
  return { models, model: found, apiKey, route, stored };
}

function microsOf(usage: Usage): number {
  return Math.round(usage.cost.total * 1_000_000);
}

export interface LlmRunUsage {
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
}

export interface LlmRunResult {
  text: string;
  usage: LlmRunUsage;
  model: string;
}

/** Shared model options for task parsing, connection checks and agent calls. */
export function modelOptions(
  model: Model<Api>,
  parameters: LlmParameters = {},
  json = false,
): SimpleStreamOptions {
  const { temperature, max_tokens, max_completion_tokens, thinking, reasoning_effort, ...rest } =
    parameters;
  const levels = getSupportedThinkingLevels(model);
  const mode =
    thinking && typeof thinking === 'object' && !Array.isArray(thinking)
      ? thinking.type
      : undefined;
  const requested = reasoning_effort;
  const enabled = mode === 'enabled' || (mode !== 'disabled' && typeof requested === 'string');
  const reasoning =
    mode === 'disabled'
      ? 'off'
      : typeof requested === 'string' && levels.includes(requested as ThinkingLevel)
        ? (requested as ThinkingLevel)
        : enabled
          ? levels.find((level) => level !== 'off')
          : levels.includes('off')
            ? 'off'
            : levels[0];
  // Common controls go through pi's per-API adapters. Chat Completions also
  // accepts native controls, including unknown models absent from the catalog.
  const isCompletions = model.api === 'openai-completions';
  const nativeThinking =
    thinking &&
    typeof thinking === 'object' &&
    !Array.isArray(thinking) &&
    Object.keys(thinking).some((key) => key !== 'type');
  const sampling = {
    ...rest,
    ...(thinking !== undefined && (isCompletions || nativeThinking) ? { thinking } : {}),
    ...(reasoning_effort !== undefined && isCompletions ? { reasoning_effort } : {}),
    ...(json && isCompletions ? { response_format: { type: 'json_object' } } : {}),
  };
  return {
    ...(reasoning && reasoning !== 'off' ? { reasoning } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(typeof max_tokens === 'number'
      ? { maxTokens: max_tokens }
      : typeof max_completion_tokens === 'number'
        ? { maxTokens: max_completion_tokens }
        : {}),
    ...(Object.keys(sampling).length > 0
      ? {
          samplingParams: sampling,
          // Some adapters do not consume samplingParams; apply extra native fields
          // to their final payload without replacing transport-owned fields.
          onPayload: (payload: unknown) =>
            payload && typeof payload === 'object' ? { ...payload, ...sampling } : payload,
        }
      : {}),
  };
}

function mapLlmError(err: unknown): never {
  if (err instanceof AppError) throw err;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    throw AppError.of(504, 'LLM_TIMEOUT');
  }
  throw AppError.of(502, 'LLM_UNAVAILABLE');
}

/** One text completion for a capability. Returns null when the capability is not configured. */
export async function completeText(
  user: User,
  capability: LlmCapability,
  input: {
    systemPrompt?: string;
    messages: { role: 'user'; content: string }[];
    timeoutMs?: number;
    /** Ask the provider for JSON-only output (OpenAI-compatible response_format). */
    json?: boolean;
  },
): Promise<LlmRunResult | null> {
  if (!executionContext()) {
    return withExecution({ userId: user.id, capability }, () => completeText(user, capability, input));
  }
  const resolved = resolveModelFor(user, capability);
  if (!resolved) {
    skipExecution('NO_MODEL');
    return null;
  }
  const context: Context = {
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    messages: input.messages.map((m) => ({ ...m, timestamp: Date.now() })),
  };
  try {
    const res = await completeModel({
      userId: user.id, capability, models: resolved.models, model: resolved.model, provider: resolved.stored.id,
    }, context, {
      ...modelOptions(resolved.model, resolved.route.parameters, input.json),
      apiKey: resolved.apiKey,
      signal: AbortSignal.timeout(input.timeoutMs ?? COMPLETE_TIMEOUT_MS),
    });
    if (res.stopReason === 'error') throw modelResponseError(res.stopReason, res.errorMessage);
    if (res.stopReason === 'aborted') throw AppError.of(504, 'LLM_TIMEOUT');
    const text = contentText(res.content).trim();
    if (!text) throw AppError.of(502, 'LLM_UNAVAILABLE');
    if (res.stopReason === 'length') throw AppError.of(502, 'LLM_OUTPUT_TRUNCATED');
    return {
      text,
      usage: {
        promptTokens: res.usage.input,
        completionTokens: res.usage.output,
        costMicros: microsOf(res.usage),
      },
      model: resolved.model.id,
    };
  } catch (err) {
    mapLlmError(err);
  }
}

/** Ping a provider+model, e.g. from the settings "test connection" button. */
export async function testProviderModel(
  userId: string,
  stored: StoredLlmProvider,
  modelId: string,
): Promise<{ ok: true }> {
  if (!executionContext()) {
    return withExecution({ userId, capability: 'llm.test' }, () => testProviderModel(userId, stored, modelId));
  }
  const apiKey = decryptSecret(stored.apiKeyEnc);
  if (!apiKey) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
  if (!stored.models.includes(modelId)) throw AppError.of(400, 'VALIDATION_ERROR');

  const route: LlmRouteTarget = {
    providerId: stored.id,
    model: modelId,
    parameters: stored.modelParameters?.[modelId],
  };
  const overridden = resolveOverride?.(stored, route, apiKey);
  let models: MutableModels;
  let target: Model<Api> | undefined;
  if (overridden) {
    models = overridden.models;
    target = overridden.model;
  } else {
    const provider = buildProvider(stored);
    const piProviderId = provider.id;
    models = createModels();
    models.setProvider(provider);
    target = models.getModel(piProviderId, modelId);
  }
  if (!target) throw AppError.of(400, 'VALIDATION_ERROR');
  const context: Context = {
    messages: [{ role: 'user', content: 'Reply with only: pong', timestamp: Date.now() }],
  };
  try {
    const result = await completeModel({
      userId, capability: 'llm.test', models, model: target, provider: stored.id,
    }, context, {
      ...modelOptions(target, route.parameters),
      apiKey,
      signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    });
    if (result.stopReason === 'error') throw AppError.of(502, 'LLM_UNAVAILABLE');
    if (result.stopReason === 'aborted') throw AppError.of(504, 'LLM_TIMEOUT');
    if (result.stopReason === 'length') throw AppError.of(502, 'LLM_OUTPUT_TRUNCATED');
    if (!contentText(result.content).trim()) throw AppError.of(502, 'LLM_UNAVAILABLE');
    return { ok: true };
  } catch (err) {
    mapLlmError(err);
  }
}
import { modelResponseError } from './model-errors.js';
