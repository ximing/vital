import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';

// 生产环境由 server 直接托管 web 构建产物（入口 nginx → server:3010，无需独立 web 容器）。
// dist 不存在（本地 dev / 测试）时跳过，API 行为不变。
declare module 'fastify' {
  interface FastifyInstance {
    webDistRoot?: string;
  }
}

export function resolveWebDistRoot(): string | null {
  if (config.NODE_ENV !== 'production') return null;
  // dev: apps/server/src → ../../web/dist；镜像: apps/server/dist → ../../web/dist
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, '../../web/dist');
  return existsSync(path.join(dist, 'index.html')) ? dist : null;
}

export async function registerWebStatic(app: FastifyInstance): Promise<void> {
  const dist = resolveWebDistRoot();
  if (!dist) return;

  app.webDistRoot = dist;

  await app.register(fastifyStatic, {
    root: dist,
    prefix: '/',
    // index 默认 true：请求 / 由插件直接回 index.html（index:false 会让 / 落进
    // wildcard 空路径，@fastify/send 抛 Forbidden → 500）
    setHeaders: (reply, pathname) => {
      // vite 产物文件名带内容 hash，可长缓存；index.html 由 not-found 兜底返回（no-store 语义交给 SPA 路由）
      if (pathname.includes('/assets/')) {
        void reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
}
