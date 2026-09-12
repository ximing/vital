import { z } from 'zod';
import { llmParametersSchema, type LlmParameters } from './auth.js';

/** Capabilities that can each be routed to a provider+model. 'default' is the fallback. */
export const LLM_CAPABILITIES = [
  'default',
  'task.parse',
  'agent.headline',
  'agent.cluster',
  'agent.decompose',
  'agent.draft',
  'agent.report',
  'agent.reflect',
  'agent.distill',
  'agent.notify',
  'agent.critic',
] as const;
export type LlmCapability = (typeof LLM_CAPABILITIES)[number];

export interface LlmCatalogModel {
  id: string;
  name: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevels?: string[];
}
export interface LlmCatalogProvider {
  id: string;
  name: string;
  models: LlmCatalogModel[];
}

const modelParametersSchema = z
  .record(z.string().trim().min(1).max(128), llmParametersSchema)
  .refine((value) => Object.keys(value).length <= 50, '最多配置 50 个模型');

const modelIdSchema = z.string().trim().min(1).max(128);

export const llmProviderInputSchema = z.object({
  /** pi-ai builtin provider id ('openai', 'anthropic', …) or 'custom' for an OpenAI-compatible endpoint. */
  providerId: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(64),
  /** Required for custom endpoints; ignored for builtin providers. */
  baseUrl: z
    .string()
    .trim()
    .max(512)
    .regex(/^https?:\/\/\S+$/i, { message: 'INVALID_LLM_API_BASE' })
    .optional(),
  /** Plaintext key on write; never returned on read. */
  apiKey: z.string().min(1).max(512),
  /** Enabled model ids, selected from the catalog or entered manually. */
  models: z.array(modelIdSchema).min(1).max(50),
  modelParameters: modelParametersSchema.optional(),
});
export type LlmProviderInput = z.infer<typeof llmProviderInputSchema>;

export const patchLlmProviderInputSchema = z
  .object({
    label: z.string().trim().min(1).max(64).optional(),
    baseUrl: z
      .string()
      .trim()
      .max(512)
      .regex(/^https?:\/\/\S+$/i, { message: 'INVALID_LLM_API_BASE' })
      .optional(),
    /** Omit to keep; a new value replaces the stored key. */
    apiKey: z.string().min(1).max(512).optional(),
    models: z.array(modelIdSchema).min(1).max(50).optional(),
    modelParameters: modelParametersSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchLlmProviderInput = z.infer<typeof patchLlmProviderInputSchema>;

/** Public shape — key material is stripped. */
export interface LlmProviderPublic {
  id: string;
  providerId: string;
  label: string;
  baseUrl: string | null;
  models: string[];
  modelParameters?: Record<string, LlmParameters>;
  apiKeySet: boolean;
}

export interface LlmRouteTarget {
  providerId: string;
  model: string;
  parameters?: LlmParameters | undefined;
}

export const llmRouteTargetSchema = z.object({
  providerId: z.string().trim().min(1).max(64),
  model: modelIdSchema,
  parameters: llmParametersSchema.optional(),
});

/** capability → target. Missing capability falls back to 'default'. */
export const llmRoutingSchema = z.record(
  z.enum(LLM_CAPABILITIES),
  llmRouteTargetSchema.nullable().optional(),
);
export type LlmRouting = z.infer<typeof llmRoutingSchema>;

export const putLlmRoutingSchema = z.object({
  routing: llmRoutingSchema,
});
export type PutLlmRoutingInput = z.infer<typeof putLlmRoutingSchema>;

export interface LlmSettingsPublic {
  providers: LlmProviderPublic[];
  routing: LlmRouting;
}

export const DEFAULT_LLM_SETTINGS: LlmSettingsPublic = { providers: [], routing: {} };

/** Resolve the effective route for a capability (falls back to 'default'). */
export function resolveLlmRoute(
  llm: LlmSettingsPublic | null | undefined,
  capability: LlmCapability,
): LlmRouteTarget | null {
  if (!llm) return null;
  const route = llm.routing[capability] ?? llm.routing.default;
  if (!route) return null;
  const provider = llm.providers.find((item) => item.id === route.providerId);
  if (!provider?.apiKeySet || !provider.models.includes(route.model)) return null;
  return route;
}

/** True when a capability can actually call a model. */
export function llmReady(
  llm: LlmSettingsPublic | null | undefined,
  capability: LlmCapability = 'default',
): boolean {
  return resolveLlmRoute(llm, capability) !== null;
}

export const testLlmConnectionInputSchema = z.object({
  providerId: z.string().trim().min(1).max(64),
  model: modelIdSchema,
});
export type TestLlmConnectionInput = z.infer<typeof testLlmConnectionInputSchema>;
