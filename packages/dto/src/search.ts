import { z } from 'zod';
import type { InboxItem } from './inbox.js';
import type { ReportListItem } from './reports.js';
import type { Task } from './tasks.js';

export const searchTypeSchema = z.enum(['task', 'inbox', 'report']);
export type SearchType = z.infer<typeof searchTypeSchema>;

export const searchInputSchema = z.object({
  q: z.string().trim().min(1).max(200),
  types: z.array(searchTypeSchema).min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

export interface TaskSearchHit {
  type: 'task';
  task: Task;
}

export interface InboxSearchHit {
  type: 'inbox';
  inbox: InboxItem;
}

export interface ReportSearchHit {
  type: 'report';
  report: ReportListItem;
}

export type SearchHit = TaskSearchHit | InboxSearchHit | ReportSearchHit;

export interface SearchResponse {
  items: SearchHit[];
  nextCursor: string | null;
}

/* ------------------------------------------------------------------------
 * Meilisearch 全局快搜（GET /api/v1/search）：跨 任务/线程/收集箱 分组返回精简命中。
 * --------------------------------------------------------------------- */

export const searchAllQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 5 : Number(value)))
    .pipe(z.number().int().min(1).max(20)),
});
export type SearchAllQuery = z.infer<typeof searchAllQuerySchema>;

export interface SearchResultTask {
  id: string;
  listId: string;
  title: string;
  status: string;
}

export interface SearchResultOutcome {
  id: string;
  name: string;
  status: string;
}

export interface SearchResultInbox {
  id: string;
  title: string;
  excerpt: string | null;
}

export interface SearchResults {
  tasks: SearchResultTask[];
  outcomes: SearchResultOutcome[];
  inbox: SearchResultInbox[];
}
