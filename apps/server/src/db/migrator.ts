import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = path.resolve(here, '../../drizzle');

export async function applyMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}
