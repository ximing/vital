import { buildFastify } from './app.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { startNotifyBus, stopNotifyBus } from './sync/notify-bus.js';
import { deliverLocalNotification } from './sync/sync.hub.js';
import { startApiTokenAccessSweeper } from './tokens/tokens.service.js';
import { startSweeper } from './uploads/sweeper.js';
import { logger } from './utils/logger.js';

const app = await buildFastify();
// 0.0.0.0 so Docker can publish the port; prod compose maps 127.0.0.1:3010:3010 (PR15).
await app.listen({ port: config.PORT, host: '0.0.0.0' });
logger.info(`server listening on :${String(config.PORT)}`, { env: config.NODE_ENV });

if (config.NODE_ENV !== 'test') {
  startSweeper();
  startApiTokenAccessSweeper();
  void startNotifyBus((message) => {
    deliverLocalNotification(message.userId, {
      type: 'notify',
      id: message.id,
      title: message.title,
      body: message.body,
      url: message.url,
    });
  }).catch((err: unknown) => {
    logger.error('notify.bus.start', err);
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info(`server received ${sig}, shutting down`);
    void app
      .close()
      .then(async () => {
        await stopNotifyBus();
        await pool.end();
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error('shutdown failed', err);
        process.exit(1);
      });
  });
}
