import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  llmRoutingSchema,
  type LlmProviderInput,
  type LlmRouting,
  type LlmSettingsPublic,
  type PatchLlmProviderInput,
} from '@vital/dto';
import { getDb } from '../db/index.js';
import { users, type StoredLlmProvider, type User } from '../db/schema.js';
import { AppError } from '../errors.js';
import { assertSafeUrl } from '../extract/ssrf.js';
import { config } from '../config.js';
import { encryptSecret } from './crypto.js';
import { BUILTIN_PROVIDER_IDS, testProviderModel } from './pi.js';

/** Local user loader — avoids an import cycle with auth.service. */
async function loadUser(userId: string): Promise<User> {
  const [row] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

/** Public LLM settings shape — key material stripped. */
export function llmPublicOf(user: User): LlmSettingsPublic {
  return {
    providers: user.llmProviders.map((p) => ({
      id: p.id,
      providerId: p.providerId,
      label: p.label,
      baseUrl: p.baseUrl ?? null,
      models: p.models,
      ...(p.modelParameters ? { modelParameters: p.modelParameters } : {}),
      apiKeySet: Boolean(p.apiKeyEnc),
    })),
    routing: user.llmRouting,
  };
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

async function saveProviders(userId: string, providers: StoredLlmProvider[]): Promise<void> {
  await getDb()
    .update(users)
    .set({ llmProviders: providers, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

function findProviderOr404(user: User, id: string): StoredLlmProvider {
  const found = user.llmProviders.find((p) => p.id === id);
  if (!found) throw AppError.of(404, 'LLM_PROVIDER_NOT_FOUND');
  return found;
}

export async function addLlmProvider(
  userId: string,
  input: LlmProviderInput,
): Promise<LlmSettingsPublic> {
  const user = await loadUser(userId);
  const isBuiltin = BUILTIN_PROVIDER_IDS.includes(input.providerId);
  if (!isBuiltin && input.providerId !== 'custom') throw AppError.of(400, 'VALIDATION_ERROR');
  if (input.providerId === 'custom') {
    if (!input.baseUrl) throw AppError.of(400, 'VALIDATION_ERROR');
    assertLlmBaseUrl(input.baseUrl);
  }
  const provider: StoredLlmProvider = {
    id: randomUUID(),
    providerId: input.providerId,
    label: input.label,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    apiKeyEnc: encryptSecret(input.apiKey),
    models: input.models,
    ...(input.modelParameters ? { modelParameters: input.modelParameters } : {}),
  };
  await saveProviders(userId, [...user.llmProviders, provider]);
  return llmPublicOf(await loadUser(userId));
}

export async function patchLlmProvider(
  userId: string,
  id: string,
  input: PatchLlmProviderInput,
): Promise<LlmSettingsPublic> {
  const user = await loadUser(userId);
  const stored = findProviderOr404(user, id);
  if (input.baseUrl !== undefined && stored.providerId === 'custom') {
    assertLlmBaseUrl(input.baseUrl);
  }
  const next: StoredLlmProvider = {
    ...stored,
    ...(input.modelParameters !== undefined ? { modelParameters: input.modelParameters } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.baseUrl !== undefined && stored.providerId === 'custom'
      ? { baseUrl: input.baseUrl }
      : {}),
    ...(input.models !== undefined ? { models: input.models } : {}),
    ...(input.apiKey !== undefined ? { apiKeyEnc: encryptSecret(input.apiKey) } : {}),
  };
  await saveProviders(
    userId,
    user.llmProviders.map((p) => (p.id === id ? next : p)),
  );
  return llmPublicOf(await loadUser(userId));
}

export async function removeLlmProvider(userId: string, id: string): Promise<LlmSettingsPublic> {
  const user = await loadUser(userId);
  findProviderOr404(user, id);
  const routing: LlmRouting = {};
  for (const [cap, target] of Object.entries(user.llmRouting)) {
    if (target && target.providerId !== id) {
      routing[cap as keyof LlmRouting] = target;
    }
  }
  await getDb()
    .update(users)
    .set({
      llmProviders: user.llmProviders.filter((p) => p.id !== id),
      llmRouting: routing,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  return llmPublicOf(await loadUser(userId));
}

export async function putLlmRouting(
  userId: string,
  routing: LlmRouting,
): Promise<LlmSettingsPublic> {
  const parsed = llmRoutingSchema.parse(routing);
  const user = await loadUser(userId);
  for (const target of Object.values(parsed)) {
    if (!target) continue;
    const stored = user.llmProviders.find((p) => p.id === target.providerId);
    if (!stored || !stored.models.includes(target.model)) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
  }
  await getDb()
    .update(users)
    .set({ llmRouting: parsed, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return llmPublicOf(await loadUser(userId));
}

export async function testLlmProvider(
  userId: string,
  id: string,
  model: string,
): Promise<{ ok: true }> {
  const user = await loadUser(userId);
  const stored = findProviderOr404(user, id);
  if (!stored.models.includes(model)) throw AppError.of(400, 'VALIDATION_ERROR');
  return testProviderModel(userId, stored, model);
}
