import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './auth/auth.routes.js';
import { config } from './config.js';
import { getDb, setDb, type Database } from './db/index.js';
import { registerHealthRoutes } from './health/health.routes.js';
import { registerInboxRoutes } from './inbox/inbox.routes.js';
import { registerLlmRoutes } from './llm/llm.routes.js';
import { registerListRoutes } from './lists/lists.routes.js';
import { populateUser } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { globalRateLimit, ipFrom } from './plugins/rate-limit.js';
import { isTrustedProxy } from './plugins/trust-proxy.js';
import { registerReportRoutes } from './reports/reports.routes.js';
import { registerSearchRoutes } from './search/search.routes.js';
import { maybePublish } from './sync/sync.hub.js';
import { registerSyncRoutes } from './sync/sync.routes.js';
import { setStorageAdapter, type UnifiedStorageAdapter } from './storage/factory.js';
import { registerTagRoutes } from './tags/tags.routes.js';
import { registerTaskRoutes } from './tasks/tasks.routes.js';
import { registerTokenRoutes } from './tokens/tokens.routes.js';
import { recordApiTokenAccess } from './tokens/tokens.service.js';
import './types.js';
import { registerNotificationRoutes } from './notifications/notifications.routes.js';
import { registerUploadRoutes } from './uploads/uploads.routes.js';
import { logger } from './utils/logger.js';

function firstHeader(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value === '' ? null : value.slice(0, 255);
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first !== 'string' || first === '') return null;
    return first.slice(0, 255);
  }
  return null;
}

export interface BuildFastifyOptions {
  db?: Database;
  storage?: UnifiedStorageAdapter | null;
}

export async function buildFastify(opts: BuildFastifyOptions = {}): Promise<FastifyInstance> {
  if (opts.db) setDb(opts.db);
  if (opts.storage !== undefined) setStorageAdapter(opts.storage);

  const app = Fastify({
    logger: false,
    // Loopback + docker-gateway hop (host nginx → 127.0.0.1:3010 publish). Not `true` (spoofed XFF).
    trustProxy: isTrustedProxy,
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
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.addHook('preHandler', populateUser);
  app.addHook('onSend', (req, reply, payload, done) => {
    void reply.header('x-request-id', req.id);
    done(null, payload);
  });
  app.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?')[0] ?? req.url;
    if (path === '/api/health') return;
    maybePublish(req.method, req.url, reply.statusCode, req.user?.id);
    logger.info('http_request', {
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      reqId: req.id,
      ms: reply.elapsedTime,
    });
    const token = req.apiToken;
    const user = req.user;
    if (!token || !user) return;
    try {
      await recordApiTokenAccess({
        tokenId: token.id,
        userId: user.id,
        method: req.method,
        path: path.slice(0, 512),
        status: reply.statusCode,
        ip: ipFrom(req),
        userAgent: firstHeader(req.headers['user-agent']),
      });
    } catch (err) {
      logger.error('api_token.access.failed', err);
    }
  });

  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerTokenRoutes(app);
  registerUploadRoutes(app);
  registerNotificationRoutes(app);
  registerListRoutes(app);
  registerLlmRoutes(app);
  registerTaskRoutes(app);
  registerTagRoutes(app);
  registerInboxRoutes(app);
  registerReportRoutes(app);
  registerSearchRoutes(app);
  registerSyncRoutes(app);

  return app;
}
