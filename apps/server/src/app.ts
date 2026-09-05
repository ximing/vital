import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './auth/auth.routes.js';
import { config } from './config.js';
import { getDb, setDb, type Database } from './db/index.js';
import { registerHealthRoutes } from './health/health.routes.js';
import { registerInboxRoutes } from './inbox/inbox.routes.js';
import { registerListRoutes } from './lists/lists.routes.js';
import { populateUser } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { globalRateLimit } from './plugins/rate-limit.js';
import { registerSearchRoutes } from './search/search.routes.js';
import { setStorageAdapter, type UnifiedStorageAdapter } from './storage/factory.js';
import { registerTagRoutes } from './tags/tags.routes.js';
import { registerTaskRoutes } from './tasks/tasks.routes.js';
import './types.js';
import { registerUploadRoutes } from './uploads/uploads.routes.js';
import { logger } from './utils/logger.js';

export interface BuildFastifyOptions {
  db?: Database;
  storage?: UnifiedStorageAdapter | null;
}

export async function buildFastify(opts: BuildFastifyOptions = {}): Promise<FastifyInstance> {
  if (opts.db) setDb(opts.db);
  if (opts.storage !== undefined) setStorageAdapter(opts.storage);

  const app = Fastify({
    logger: false,
    // Only trust loopback proxies (nginx / compose). `true` honors any spoofed X-Forwarded-For.
    trustProxy: (address: string) => address === '127.0.0.1' || address === '::1',
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
  });

  app.decorate('db', getDb());

  await app.register(helmet);
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });
  await app.register(cookie, { secret: config.COOKIE_SECRET });
  await app.register(rateLimit, globalRateLimit);

  app.addHook('preHandler', populateUser);
  app.addHook('onSend', (req, reply, payload, done) => {
    void reply.header('x-request-id', req.id);
    done(null, payload);
  });
  app.addHook('onResponse', (req, reply, done) => {
    if (req.url === '/api/health') {
      done();
      return;
    }
    logger.info('http_request', {
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      reqId: req.id,
      ms: reply.elapsedTime,
    });
    done();
  });

  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerUploadRoutes(app);
  registerListRoutes(app);
  registerTaskRoutes(app);
  registerTagRoutes(app);
  registerInboxRoutes(app);
  registerSearchRoutes(app);

  return app;
}
