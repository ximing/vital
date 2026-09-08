import type { UploadedPart } from '@vital/dto';
import mime from 'mime-types';

/**
 * Per-row storage snapshot. After a bucket/prefix change, old attachments
 * still sign against the meta written at insert time.
 */
export interface StorageMetadata {
  bucket?: string;
  prefix?: string;
  endpoint?: string;
  region?: string;
  isPublicBucket?: 'true' | 'false';
}

export interface PutMeta {
  contentType: string;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface HeadObjectResult {
  size: number;
  contentType: string | undefined;
  lastModified: Date;
}

/** Unified storage adapter — method names must not change. */
export interface UnifiedStorageAdapter {
  uploadFile(key: string, buffer: Buffer): Promise<void>;
  deleteFile(key: string, metadata?: StorageMetadata): Promise<void>;
  fileExists(key: string): Promise<boolean>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  copyObject(srcKey: string, destKey: string, metadata?: StorageMetadata): Promise<void>;
  generateAccessUrl(
    key: string,
    metadata: StorageMetadata,
    expiresIn?: number,
    signingDate?: Date,
  ): Promise<string>;
  initMultipart(key: string, meta: PutMeta): Promise<string>;
  presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number,
  ): Promise<string>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer>;
}

export abstract class BaseUnifiedStorageAdapter implements UnifiedStorageAdapter {
  abstract uploadFile(key: string, buffer: Buffer): Promise<void>;
  abstract deleteFile(key: string, metadata?: StorageMetadata): Promise<void>;
  abstract fileExists(key: string): Promise<boolean>;
  abstract headObject(key: string): Promise<HeadObjectResult | null>;
  abstract copyObject(srcKey: string, destKey: string, metadata?: StorageMetadata): Promise<void>;
  abstract generateAccessUrl(
    key: string,
    metadata: StorageMetadata,
    expiresIn?: number,
    signingDate?: Date,
  ): Promise<string>;
  abstract initMultipart(key: string, meta: PutMeta): Promise<string>;
  abstract presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number,
  ): Promise<string>;
  abstract listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  abstract completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abstract abortMultipart(key: string, uploadId: string): Promise<void>;
  abstract getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer>;

  /** Dangerous types become octet-stream so a private bucket cannot host HTML/SVG. */
  protected getContentType(key: string): string {
    const filename = key.split('/').pop() ?? key;
    const mimeType = mime.lookup(filename);
    if (
      typeof mimeType !== 'string' ||
      mimeType === 'text/html' ||
      mimeType === 'text/plain' ||
      mimeType === 'application/javascript' ||
      mimeType === 'text/javascript' ||
      mimeType === 'image/svg+xml'
    ) {
      return 'application/octet-stream';
    }
    return mimeType;
  }
}
