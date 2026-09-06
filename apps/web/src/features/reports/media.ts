import { ATTACHMENT_MIME_TYPES, IMAGE_MIME_TYPES } from '@vital/dto';
import { client } from '@/api/client';

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

export function isAllowedUploadMime(mime: string): boolean {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime);
}

export type ReportUpload = {
  id: string;
  src: string;
  mime: string;
  name: string;
};

export async function uploadReportFile(file: File, reportId: string): Promise<ReportUpload> {
  const mime = file.type;
  if (!isAllowedUploadMime(mime)) {
    throw new Error('unsupported-mime');
  }
  const uploaded = await client.upload({ file, mime, size: file.size });
  await client.bindUpload(uploaded.id, { ownerType: 'report', ownerId: reportId });
  return {
    id: uploaded.id,
    src: `/api/v1/uploads/${uploaded.id}`,
    mime: uploaded.mime,
    name: file.name,
  };
}
