import { config } from '../src/config.js';
import { pool } from '../src/db/index.js';
import { assertDevelopmentSeed, SAMPLE_TAG, seedSampleTasksForEmail } from '../src/seed/sample.js';
import { logger } from '../src/utils/logger.js';

try {
  assertDevelopmentSeed(config.NODE_ENV);
  const email = (process.argv[2] ?? process.env.SEED_EMAIL ?? '').trim();
  if (email === '') {
    logger.error('seed.usage', { hint: 'pnpm --filter @vital/server seed <email>' });
    process.exitCode = 1;
  } else {
    const result = await seedSampleTasksForEmail(email);
    logger.info('seed.ok', { ...result, tag: SAMPLE_TAG });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : 'seed failed';
  logger.error('seed.fail', { message });
  process.exitCode = 1;
} finally {
  await pool.end();
}
