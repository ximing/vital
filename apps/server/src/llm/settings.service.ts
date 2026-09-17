import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  compactLlmModelPricingMap,
  llmRoutingSchema,
  type LlmParameters,
  type LlmProviderInput,
  type LlmRouting,
  type LlmSettingsPublic,
  type PatchLlmProviderInput,
} from '@vital/dto';
import { getDb } from '../db/index.js';
import {
  userLlmProviders,
  userLlmRoutes,
  users,
  type LlmStore,
  type StoredLlmProvider,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { assertSafeUrl } from '../extract/ssrf.js';
import { config } from '../config.js';
import { encryptSecret } from './crypto.js';
import { BUILTIN_PROVIDER_IDS, testProviderModel } from './pi.js';
import { loadLlmPublic, loadLlmStore } from './store.js';

export { loadLlmPublic, loadLlmStore, llmPublicOf } from './store.js';

async function assertUser(userId: string): Promise<void> {
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
}

/** Custom endpoint base URLs must survive the same SSRF rules as the old client. */
export function assertLlmBaseUrl(raw: string): void {
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
}

function findProviderOr404(store: LlmStore, id: string): StoredLlmProvider {
  const found = store.providers.find((p) => p.id === id);
  if (!found) throw AppError.of(404, 'LLM_PROVIDER_NOT_FOUND');
  return found;
}

export async function addLlmProvider(
  userId: string,
  input: LlmProviderInput,
): Promise<LlmSettingsPublic> {
  await assertUser(userId);
  const isBuiltin = BUILTIN_PROVIDER_IDS.includes(input.providerId);
  if (!isBuiltin && input.providerId !== 'custom') throw AppError.of(400, 'VALIDATION_ERROR');
  if (input.providerId === 'custom') {
    if (!input.baseUrl) throw AppError.of(400, 'VALIDATION_ERROR');
    assertLlmBaseUrl(input.baseUrl);
  }
  const now = new Date();
  await getDb().insert(userLlmProviders).values({
    id: randomUUID(),
    userId,
    providerId: input.providerId,
    label: input.label,
    baseUrl: input.baseUrl ?? null,
    apiKeyEnc: encryptSecret(input.apiKey),
    models: input.models,
    modelParameters: input.modelParameters ?? null,
    modelPricing: compactLlmModelPricingMap(input.modelPricing, input.models) ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return loadLlmPublic(userId);
}

export async function patchLlmProvider(
  userId: string,
  id: string,
  input: PatchLlmProviderInput,
): Promise<LlmSettingsPublic> {
  const store = await loadLlmStore(userId);
  const stored = findProviderOr404(store, id);
  if (input.baseUrl !== undefined && stored.providerId === 'custom') {
    assertLlmBaseUrl(input.baseUrl);
  }
  const nextModels = input.models ?? stored.models;
  const pricingTouched = input.modelPricing !== undefined || input.models !== undefined;
  await getDb()
    .update(userLlmProviders)
    .set({
      ...(input.modelParameters !== undefined ? { modelParameters: input.modelParameters } : {}),
      ...(pricingTouched
        ? {
            modelPricing:
              compactLlmModelPricingMap(
                input.modelPricing !== undefined ? input.modelPricing : stored.modelPricing,
                nextModels,
              ) ?? null,
          }
        : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.baseUrl !== undefined && stored.providerId === 'custom'
        ? { baseUrl: input.baseUrl }
        : {}),
      ...(input.models !== undefined ? { models: input.models } : {}),
      ...(input.apiKey !== undefined ? { apiKeyEnc: encryptSecret(input.apiKey) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(userLlmProviders.id, id));
  return loadLlmPublic(userId);
}

export async function removeLlmProvider(userId: string, id: string): Promise<LlmSettingsPublic> {
  const store = await loadLlmStore(userId);
  findProviderOr404(store, id);
  await getDb().transaction(async (tx) => {
    await tx.delete(userLlmRoutes).where(and(eq(userLlmRoutes.userId, userId), eq(userLlmRoutes.providerId, id)));
    await tx.delete(userLlmProviders).where(and(eq(userLlmProviders.id, id), eq(userLlmProviders.userId, userId)));
  });
  return loadLlmPublic(userId);
}

export async function putLlmRouting(
  userId: string,
  routing: LlmRouting,
): Promise<LlmSettingsPublic> {
  const parsed = llmRoutingSchema.parse(routing);
  const store = await loadLlmStore(userId);
  const rows: Array<{
    userId: string;
    capability: string;
    providerId: string;
    model: string;
    parameters: LlmParameters | null;
  }> = [];
  for (const [capability, target] of Object.entries(parsed)) {
    if (!target) continue;
    const stored = store.providers.find((p) => p.id === target.providerId);
    if (!stored || !stored.models.includes(target.model)) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    rows.push({
      userId,
      capability,
      providerId: target.providerId,
      model: target.model,
      parameters: target.parameters ?? null,
    });
  }
  await getDb().transaction(async (tx) => {
    await tx.delete(userLlmRoutes).where(eq(userLlmRoutes.userId, userId));
    if (rows.length > 0) await tx.insert(userLlmRoutes).values(rows);
  });
  return loadLlmPublic(userId);
}

export async function testLlmProvider(
  userId: string,
  id: string,
  model: string,
): Promise<{ ok: true }> {
  const store = await loadLlmStore(userId);
  const stored = findProviderOr404(store, id);
  if (!stored.models.includes(model)) throw AppError.of(400, 'VALIDATION_ERROR');
  const [row] = await getDb()
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return testProviderModel(userId, stored, model, row?.timezone ?? 'Asia/Shanghai');
}
