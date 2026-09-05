import { pool } from './index.js';
import { applyMigrations } from './migrator.js';
import { backfillInboxLists } from '../lists/lists.service.js';
import { logger } from '../utils/logger.js';

await applyMigrations();
const n = await backfillInboxLists();
logger.info('migrations applied', { inboxBackfill: n });
await pool.end();
