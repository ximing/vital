import { z } from 'zod';
import { uuidSchema } from './lists.js';
import type { InboxItem } from './inbox.js';

export const INWIT_DEFAULT_BASE_URL = 'https://inwit.aimo.plus';

/** inwit Personal Access Token (`iwt_` prefix + base64url). */
export const inwitAccessKeySchema = z
  .string()
  .trim()
  .regex(/^iwt_[A-Za-z0-9_-]{40,}$/, 'inwit accessKey 格式不合法');

export const inwitConfigInputSchema = z
  .object({
    baseUrl: z.string().trim().url().max(512).optional(),
    /** Sent once at save time; stored encrypted, never returned. Omit to keep current. */
    accessKey: inwitAccessKeySchema.optional(),
    defaultTopicId: uuidSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type InwitConfigInput = z.infer<typeof inwitConfigInputSchema>;

export interface InwitConfigPublic {
  baseUrl: string;
  accessKeySet: boolean;
  defaultTopicId: string | null;
}

export interface InwitTopic {
  id: string;
  title: string;
}

export interface InwitTestResponse {
  ok: true;
  topics: InwitTopic[];
}

export interface InboxExportInwitResponse {
  inbox: InboxItem;
  inwitDocumentId: string;
}
