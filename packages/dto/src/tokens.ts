import { z } from 'zod';
import { uuidSchema } from './lists.js';

export const API_TOKEN_PREFIX = 'vt_';
export const API_TOKEN_PREFIX_LENGTH = 12;
export const API_TOKEN_MAX_PER_USER = 20;
export const API_TOKEN_ACCESS_RETENTION_DAYS = 30;

export function isApiTokenSecret(raw: string): boolean {
  return raw.startsWith(API_TOKEN_PREFIX) && raw.length >= API_TOKEN_PREFIX.length + 20;
}

export const createApiTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenInputSchema>;

export const apiTokenIdParamsSchema = z.object({
  id: uuidSchema,
});
export type ApiTokenIdParams = z.infer<typeof apiTokenIdParamsSchema>;

const limitSchema = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? 50 : Number(value)))
  .pipe(z.number().int().min(1).max(100));

export const listApiTokenAccessQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: limitSchema,
});
export type ListApiTokenAccessQuery = z.infer<typeof listApiTokenAccessQuerySchema>;

export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedApiToken extends ApiToken {
  token: string;
}

export interface ApiTokenCollection {
  items: ApiToken[];
}

export interface ApiTokenAccessLog {
  id: string;
  method: string;
  path: string;
  status: number;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ApiTokenAccessCollection {
  items: ApiTokenAccessLog[];
  nextCursor: string | null;
}
