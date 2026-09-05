import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { config } from '../../src/config.js';

export const WEB_ORIGIN = config.WEB_ORIGIN;

export function cookieFrom(res: LightMyRequestResponse, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const found = list.find((c) => c.startsWith(`${name}=`));
  if (!found) return undefined;
  return found.split(';')[0];
}

export function requireCookie(res: LightMyRequestResponse, name: string): string {
  const value = cookieFrom(res, name);
  if (!value) throw new Error(`expected Set-Cookie ${name}`);
  return value;
}

export function cookieCleared(res: LightMyRequestResponse, name: string): boolean {
  const raw = res.headers['set-cookie'];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const found = list.find((c) => c.startsWith(`${name}=`));
  if (!found) return false;
  return /max-age=0/i.test(found);
}

export async function injectJson(
  app: FastifyInstance,
  opts: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
    url: string;
    payload?: InjectOptions['payload'];
    origin?: string;
    token?: string;
    cookie?: string;
  },
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  if (opts.origin) headers.origin = opts.origin;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  const injectOpts: InjectOptions = {
    method: opts.method,
    url: opts.url,
    headers,
  };
  if (opts.payload !== undefined) {
    injectOpts.payload = opts.payload;
  }
  return app.inject(injectOpts);
}
