import { eq } from 'drizzle-orm';
import type { LlmRouting, LlmSettingsPublic } from '@vital/dto';
import { getDb } from '../db/index.js';
import {
  userLlmProviders,
  userLlmRoutes,
  type LlmStore,
  type StoredLlmProvider,
  type UserLlmProviderRow,
  type UserLlmRouteRow,
} from '../db/schema.js';

function providerFromRow(row: UserLlmProviderRow): StoredLlmProvider {
  return {
    id: row.id,
    providerId: row.providerId,
    label: row.label,
    ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
    apiKeyEnc: row.apiKeyEnc,
    models: row.models,
    ...(row.modelParameters ? { modelParameters: row.modelParameters } : {}),
  };
}

function routingFromRows(rows: UserLlmRouteRow[]): LlmRouting {
  const routing: LlmRouting = {};
  for (const row of rows) {
    routing[row.capability as keyof LlmRouting] = {
      providerId: row.providerId,
      model: row.model,
      ...(row.parameters ? { parameters: row.parameters } : {}),
    };
  }
  return routing;
}

export async function loadLlmStore(userId: string): Promise<LlmStore> {
  const [providerRows, routeRows] = await Promise.all([
    getDb().select().from(userLlmProviders).where(eq(userLlmProviders.userId, userId)),
    getDb().select().from(userLlmRoutes).where(eq(userLlmRoutes.userId, userId)),
  ]);
  return {
    providers: providerRows.map(providerFromRow),
    routing: routingFromRows(routeRows),
  };
}

/** Public LLM settings shape — key material stripped. */
export function llmPublicOf(store: LlmStore): LlmSettingsPublic {
  return {
    providers: store.providers.map((p) => ({
      id: p.id,
      providerId: p.providerId,
      label: p.label,
      baseUrl: p.baseUrl ?? null,
      models: p.models,
      ...(p.modelParameters ? { modelParameters: p.modelParameters } : {}),
      apiKeySet: Boolean(p.apiKeyEnc),
    })),
    routing: store.routing,
  };
}

export async function loadLlmPublic(userId: string): Promise<LlmSettingsPublic> {
  return llmPublicOf(await loadLlmStore(userId));
}
