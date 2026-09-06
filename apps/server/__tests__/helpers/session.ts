import type { FastifyInstance } from 'fastify';
import { injectJson } from './http.js';

export async function registerUser(
  app: FastifyInstance,
  name = 'alice',
): Promise<{ id: string; token: string; email: string }> {
  const email = `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}@test.com`;
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'secret123', displayName: name },
  });
  if (res.statusCode !== 201) {
    throw new Error(`register failed ${res.statusCode} ${res.body}`);
  }
  const body = res.json();
  return { id: body.user.id, token: body.tokens.accessToken, email };
}

export async function inboxId(app: FastifyInstance, token: string): Promise<string> {
  const res = await injectJson(app, { method: 'GET', url: '/api/v1/lists', token });
  const inbox = res.json().items.find((l: { kind: string }) => l.kind === 'inbox');
  if (!inbox) throw new Error('missing inbox list');
  return inbox.id as string;
}
