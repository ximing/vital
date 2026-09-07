import '@fastify/websocket';
import type { Database } from './db/index.js';

export type AuthPrincipal = { id: string };

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthPrincipal;
  }
  interface FastifyInstance {
    db: Database;
  }
}

export {};
