import { z } from 'zod';
import { uuidSchema } from './lists.js';
import type { Task } from './tasks.js';

/** Request-thread extract HTML cap (v1). */
export const MAX_EXTRACT_HTML_BYTES = 2 * 1024 * 1024;
/** POST/PATCH inbox JSON so confirm can send back a 2MB extract preview. */
export const INBOX_JSON_BODY_LIMIT_BYTES = Math.ceil(2.5 * 1024 * 1024);
/** Per-image cap for extract/rehost. */
export const MAX_EXTRACT_IMAGE_BYTES = 2 * 1024 * 1024;
/** PATCH safety ceiling. The extension rehosts every article image up to this. */
export const MAX_INBOX_ASSETS = 200;

export const inboxStatusSchema = z.enum(['unread', 'later', 'archived', 'converted']);
export type InboxStatus = z.infer<typeof inboxStatusSchema>;

export const inboxSourceSchema = z.enum(['extension', 'wechat', 'web', 'mobile', 'manual']);
export type InboxSource = z.infer<typeof inboxSourceSchema>;

const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://'),
    'http(s) URL required',
  );

export interface InboxAsset {
  id: string;
  attachmentId: string;
  /** MIME type of the underlying attachment, e.g. `application/pdf`. */
  mime: string;
  /** Private S3 URL, signed by the server for six hours. */
  url?: string;
  originalSrc: string;
  sortOrder: number;
}

export interface InboxItem {
  id: string;
  title: string;
  originalUrl: string | null;
  canonicalUrl: string | null;
  extractedText: string | null;
  extractedHtml: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  status: InboxStatus;
  source: InboxSource;
  capturedAt: string;
  readAt: string | null;
  convertedTaskId: string | null;
  assets: InboxAsset[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Same shape as InboxItem minus id / timestamps. */
export type InboxPreview = Omit<
  InboxItem,
  'id' | 'capturedAt' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export interface InboxCollection {
  items: InboxItem[];
  nextCursor: string | null;
}

export const extractInboxInputSchema = z.object({
  url: httpUrlSchema,
});
export type ExtractInboxInput = z.infer<typeof extractInboxInputSchema>;

export const createInboxInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  originalUrl: httpUrlSchema.nullable().optional(),
  extractedText: z.string().max(MAX_EXTRACT_HTML_BYTES).nullable().optional(),
  extractedHtml: z.string().max(MAX_EXTRACT_HTML_BYTES).nullable().optional(),
  excerpt: z.string().trim().max(500).nullable().optional(),
  byline: z.string().trim().max(200).nullable().optional(),
  siteName: z.string().trim().max(200).nullable().optional(),
  source: inboxSourceSchema.optional(),
});
export type CreateInboxInput = z.infer<typeof createInboxInputSchema>;

export const patchInboxInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    status: z.enum(['unread', 'later', 'archived']).optional(),
    extractedText: z.string().max(MAX_EXTRACT_HTML_BYTES).nullable().optional(),
    extractedHtml: z.string().max(MAX_EXTRACT_HTML_BYTES).nullable().optional(),
    excerpt: z.string().trim().max(500).nullable().optional(),
    byline: z.string().trim().max(200).nullable().optional(),
    siteName: z.string().trim().max(200).nullable().optional(),
    readAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchInboxInput = z.infer<typeof patchInboxInputSchema>;

export const inboxAssetInputSchema = z.object({
  attachmentId: uuidSchema,
  originalSrc: z.string().min(1).max(4096),
  sortOrder: z.number().int().min(0).max(10_000),
});
export type InboxAssetInput = z.infer<typeof inboxAssetInputSchema>;

export const patchInboxAssetsInputSchema = z.object({
  assets: z.array(inboxAssetInputSchema).max(MAX_INBOX_ASSETS),
});
export type PatchInboxAssetsInput = z.infer<typeof patchInboxAssetsInputSchema>;

export const convertInboxInputSchema = z
  .object({
    listId: uuidSchema.optional(),
    title: z.string().trim().min(1).max(500).optional(),
  })
  .default({});
export type ConvertInboxInput = z.infer<typeof convertInboxInputSchema>;

export interface ConvertInboxResponse {
  inbox: InboxItem;
  task: Task;
}

export const listInboxQuerySchema = z.object({
  status: inboxStatusSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 50 : Number(value)))
    .pipe(z.number().int().min(1).max(100)),
});
export type ListInboxQuery = z.infer<typeof listInboxQuerySchema>;

export const idempotencyKeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'sha256 hex')
  .transform((value) => value.toLowerCase());
