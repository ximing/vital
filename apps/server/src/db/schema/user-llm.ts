import { sql } from 'drizzle-orm';
import { char, check, index, jsonb, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { LlmModelPricing, LlmParameters, LlmRouting } from '@vital/dto';

/** Stored LLM provider config. apiKeyEnc is encryptSecret() output — never leaves the server. */
export interface StoredLlmProvider {
  id: string;
  /** pi-ai builtin provider id ('openai', 'anthropic', …) or 'custom'. */
  providerId: string;
  label: string;
  baseUrl?: string;
  apiKeyEnc: string;
  models: string[];
  modelParameters?: Record<string, LlmParameters>;
  modelPricing?: Record<string, LlmModelPricing>;
}

export interface LlmStore {
  providers: StoredLlmProvider[];
  routing: LlmRouting;
}

export const userLlmProviders = pgTable(
  'user_llm_providers',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    providerId: varchar('provider_id', { length: 64 }).notNull(),
    label: varchar('label', { length: 64 }).notNull(),
    baseUrl: varchar('base_url', { length: 512 }),
    apiKeyEnc: text('api_key_enc').notNull(),
    models: jsonb('models').$type<string[]>().notNull(),
    modelParameters: jsonb('model_parameters').$type<Record<string, LlmParameters>>(),
    modelPricing: jsonb('model_pricing').$type<Record<string, LlmModelPricing>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_user_llm_providers_user').on(t.userId)],
);

export const userLlmRoutes = pgTable(
  'user_llm_routes',
  {
    userId: char('user_id', { length: 36 }).notNull(),
    capability: varchar('capability', { length: 32 }).notNull(),
    /** user_llm_providers.id — the saved provider row, not the builtin vendor id. */
    providerId: char('provider_id', { length: 36 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    parameters: jsonb('parameters').$type<LlmParameters>(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.capability] }),
    index('idx_user_llm_routes_provider').on(t.providerId),
    check(
      'user_llm_routes_capability_check',
      sql`${t.capability} IN ('default', 'task.parse', 'agent.headline', 'agent.cluster', 'agent.decompose', 'agent.draft', 'agent.report', 'agent.reflect', 'agent.distill', 'agent.notify', 'agent.critic')`,
    ),
  ],
);

export type UserLlmProviderRow = typeof userLlmProviders.$inferSelect;
export type NewUserLlmProvider = typeof userLlmProviders.$inferInsert;
export type UserLlmRouteRow = typeof userLlmRoutes.$inferSelect;
