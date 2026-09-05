import { z } from 'zod';
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

export type SearchHit = TaskSearchHit;

export interface SearchResponse {
  items: SearchHit[];
  nextCursor: string | null;
}
