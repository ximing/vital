import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadEnv({ path: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'] });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    host: process.env.PG_HOST ?? '127.0.0.1',
    port: Number(process.env.PG_PORT ?? 5432),
    user: process.env.PG_USER ?? 'vital_dev_user',
    password: process.env.PG_PASSWORD ?? 'change-me',
    database: process.env.PG_DATABASE ?? 'vital_dev',
    ssl: process.env.PG_SSL === 'true',
  },
});
