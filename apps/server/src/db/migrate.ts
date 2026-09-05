import { pool } from './index.js';
import { applyMigrations } from './migrator.js';
import { logger } from '../utils/logger.js';

await applyMigrations();
logger.info('migrations applied');
await pool.end();
