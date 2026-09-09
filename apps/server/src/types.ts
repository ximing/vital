import '@fastify/websocket';
import type { Database } from './db/index.js';

export type AuthPrincipal = { id: string };
export type ApiTokenPrincipal = { id: string };

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthPrincipal;
    apiToken?: ApiTokenPrincipal;
  }
  interface FastifyInstance {
    db: Database;
  }
}

export {};
