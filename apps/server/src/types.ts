import type { UserProfile } from '@vital/dto';
import type { Database } from './db/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserProfile;
  }
  interface FastifyInstance {
    db: Database;
  }
}

export {};
