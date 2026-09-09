import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ path: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'] });

const boolEnum = z.enum(['true', 'false']).transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3010),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PG_HOST: z.string().min(1),
  PG_PORT: z.coerce.number().default(5432),
  PG_USER: z.string().min(1),
  PG_PASSWORD: z.string().min(1),
  PG_DATABASE: z.string().min(1),
  PG_SSL: boolEnum.default('false'),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ATTACHMENT_S3_BUCKET: z.string().min(1),
  ATTACHMENT_S3_PREFIX: z.string().default('dev/attachments'),
  ATTACHMENT_S3_ENDPOINT: z.string().optional(),
  ATTACHMENT_S3_REGION: z.string().default('us-east-1'),
  ATTACHMENT_S3_ACCESS_KEY_ID: z.string().min(1),
  ATTACHMENT_S3_SECRET_ACCESS_KEY: z.string().min(1),
  // Never z.coerce.boolean(): the string 'false' would become true.
  ATTACHMENT_S3_IS_PUBLIC: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
    .refine((value) => !value, {
      message: 'PUBLIC_BUCKET_UNSUPPORTED: MVP 仅支持私有桶',
    }),
  PRESIGN_GET_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 3600)
    .default(6 * 3600),
  PRESIGN_PUT_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
  SWEEPER_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  SWEEPER_DRY_RUN: boolEnum.default('true'),
  MEDIA_UPLOADING_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  WEB_ORIGIN: z.string().url().default('http://localhost:5180'),
  COOKIE_SECURE: boolEnum.default('false'),
  MEOW_BASE_URL: z.string().url().default('https://api.chuckfang.com'),
  NOTIFY_ICON_URL: z.string().url().optional(),
  WORKER_POLL_MS: z.coerce.number().int().min(1_000).default(15_000),
  WORKER_CLAIM_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_HEAL_INTERVAL_MS: z.coerce.number().int().min(10_000).default(300_000),
  AGENT_ENABLED: boolEnum.default('true'),
  AGENT_CRITIC_ENABLED: boolEnum.default('false'),
  AGENT_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(10_000).default(300_000),
  AGENT_UNDO_WINDOW_HOURS: z.coerce.number().int().min(1).default(24),
  AGENT_CLUSTER_MIN_UNASSIGNED: z.coerce.number().int().min(1).default(4),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
