import { z } from 'zod';

/** User attach max 10MB. Shared by server and clients. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * MIME whitelist. SVG is excluded: a presigned GET would serve image/svg+xml
 * and browsers would execute nested script (stored XSS).
 */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const attachmentOwnerTypeSchema = z.enum(['tmp', 'task', 'inbox', 'report']);
export type AttachmentOwnerType = z.infer<typeof attachmentOwnerTypeSchema>;

export const attachmentStatusSchema = z.enum(['uploading', 'ready', 'orphaned']);
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;

export const uploadPresignInputSchema = z
  .object({
    mime: z.string().min(3).max(100),
    size: z.number().int().positive(),
  })
  .superRefine((val, ctx) => {
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(val.mime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MIME_KIND_MISMATCH',
        path: ['mime'],
      });
    }
  });
export type UploadPresignInput = z.infer<typeof uploadPresignInputSchema>;

export interface UploadPresignResponse {
  id: string;
  method: 'put';
  url: string;
  expiresIn: number;
}

export const uploadCompleteInputSchema = z.object({}).default({});
export type UploadCompleteInput = z.infer<typeof uploadCompleteInputSchema>;

export interface UploadCompleteResponse {
  id: string;
  status: 'ready';
  mime: string;
  size: number;
  ownerType: 'tmp';
}

export const uploadBindInputSchema = z.object({
  ownerType: z.enum(['task', 'inbox', 'report']),
  ownerId: z.string().uuid(),
});
export type UploadBindInput = z.infer<typeof uploadBindInputSchema>;

export interface UploadBindResponse {
  id: string;
  status: 'ready';
  ownerType: 'task' | 'inbox' | 'report';
  ownerId: string;
}
