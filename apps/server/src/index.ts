import { buildFastify } from './app.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { startSweeper } from './uploads/sweeper.js';
import { logger } from './utils/logger.js';

const app = await buildFastify();
await app.listen({ port: config.PORT, host: '0.0.0.0' });
logger.info(`server listening on :${String(config.PORT)}`, { env: config.NODE_ENV });

if (config.NODE_ENV !== 'test') {
  startSweeper();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info(`server received ${sig}, shutting down`);
    void app
      .close()
      .then(async () => {
        await pool.end();
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error('shutdown failed', err);
        process.exit(1);
      });
  });
}
