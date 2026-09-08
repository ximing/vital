import { z } from 'zod';

/** Single-file upload cap (5GB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
/** S3 multipart: every part except the last must be at least 5MB. */
export const MIN_UPLOAD_PART_BYTES = 5 * 1024 * 1024;
/** S3 multipart hard part-count limit. */
export const MAX_UPLOAD_PARTS = 10_000;

export function partSizeFor(size: number): number {
  return Math.max(MIN_UPLOAD_PART_BYTES, Math.ceil(size / MAX_UPLOAD_PARTS));
}

export function totalPartsFor(size: number): number {
  if (size <= 0) return 0;
  return Math.ceil(size / partSizeFor(size));
}

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

/** Report editor attachments: images plus a small file set. Still no SVG. */
export const ATTACHMENT_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  'application/pdf',
  'text/plain',
  'text/markdown',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/flac',
] as const;

export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export function isUploadableMime(mime: string): boolean {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime);
}

export const attachmentOwnerTypeSchema = z.enum(['tmp', 'task', 'inbox', 'report', 'user']);
export type AttachmentOwnerType = z.infer<typeof attachmentOwnerTypeSchema>;

export const attachmentStatusSchema = z.enum(['uploading', 'ready', 'orphaned']);
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;

export interface UploadCompleteResponse {
  id: string;
  status: 'ready';
  mime: string;
  size: number;
  ownerType: 'tmp';
}

export const uploadBindInputSchema = z.object({
  ownerType: z.enum(['task', 'inbox', 'report', 'user']),
  ownerId: z.string().uuid(),
});
export type UploadBindInput = z.infer<typeof uploadBindInputSchema>;

export interface UploadBindResponse {
  id: string;
  status: 'ready';
  ownerType: 'task' | 'inbox' | 'report' | 'user';
  ownerId: string;
}

export interface UploadedPart {
  partNumber: number;
  size: number;
  etag: string;
}

export const uploadInitInputSchema = z.object({
  mime: z.string().min(3).max(100),
  size: z.number().int().positive(),
  filename: z.string().trim().min(1).max(255).optional(),
  resumeId: z.string().uuid().optional(),
});
export type UploadInitInput = z.infer<typeof uploadInitInputSchema>;

export interface UploadInitResponse {
  id: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
  parts: UploadedPart[];
}

export interface UploadPartsResponse {
  parts: UploadedPart[];
}

export interface PartPresignResponse {
  url: string;
  expiresIn: number;
}

export const uploadCompletePartsInputSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(MAX_UPLOAD_PARTS),
        etag: z.string().min(1).max(128),
      }),
    )
    .min(1)
    .max(MAX_UPLOAD_PARTS),
});
export type UploadCompletePartsInput = z.infer<typeof uploadCompletePartsInputSchema>;

export interface UploadUrlResponse {
  url: string;
  expiresIn: number;
}
