import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({
  host: config.PG_HOST,
  port: config.PG_PORT,
  user: config.PG_USER,
  password: config.PG_PASSWORD,
  database: config.PG_DATABASE,
  ssl: config.PG_SSL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 1000,
  allowExitOnIdle: true,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;

let override: Database | null = null;

export function getDb(): Database {
  return override ?? db;
}

/** Test seam. Do not call from product code. */
export function setDb(next: Database | null): void {
  override = next;
}
