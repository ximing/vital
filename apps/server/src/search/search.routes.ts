import { searchAllQuerySchema, searchInputSchema, type SearchResults } from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { requireAuth } from '../plugins/auth.js';
import { limitSearch } from '../plugins/rate-limit.js';
import { searchAll } from '../retrieval/search.js';
import { searchTasks } from './search.service.js';

const EMPTY_RESULTS: SearchResults = { tasks: [], outcomes: [], inbox: [] };

export function registerSearchRoutes(app: FastifyInstance): void {
  app.post('/api/v1/search', { preHandler: [requireAuth, limitSearch] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    return searchTasks(user.id, searchInputSchema.parse(req.body));
  });

  /**
   * Meilisearch 全局快搜（任务/线程/收集箱分组）。Meili 未配置时 searchAll
   * 返回 null —— 降级返回空分组而不是 503，搜索对业务不是硬依赖；Meili
   * 故障同样记日志后降级为空分组。
   */
  app.get('/api/v1/search', { preHandler: [requireAuth, limitSearch] }, async (req) => {
    const user = req.user;
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    const query = searchAllQuerySchema.parse(req.query);
    try {
      const results = await searchAll({ userId: user.id, q: query.q, limit: query.limit });
      return results ?? EMPTY_RESULTS;
    } catch (err) {
      console.error('[retrieval] searchAll failed', err);
      return EMPTY_RESULTS;
    }
  });
}
