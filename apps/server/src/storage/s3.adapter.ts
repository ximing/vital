import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  type ListPartsCommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { UploadedPart } from '@vital/dto';
import { logger } from '../utils/logger.js';
import {
  BaseUnifiedStorageAdapter,
  type CompletedPart,
  type HeadObjectResult,
  type PutMeta,
  type StorageMetadata,
} from './base.adapter.js';
import { ObjectTooLargeError, abortS3Body, readBodyWithLimit } from './bounded-read.js';

export interface S3UnifiedStorageAdapterConfig {
  bucket: string;
  prefix?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  isPublic?: boolean;
}

export class S3UnifiedStorageAdapter extends BaseUnifiedStorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly endpoint: string | undefined;
  private readonly region: string;
  private readonly isPublic: boolean;

  constructor(cfg: S3UnifiedStorageAdapterConfig) {
    super();
    if (!cfg.bucket) throw new Error('S3 bucket name is required');
    this.bucket = cfg.bucket;
    this.prefix = cfg.prefix || 'uploads';
    this.endpoint = cfg.endpoint;
    this.region = cfg.region || 'us-east-1';
    this.isPublic = cfg.isPublic || false;

    // Aliyun OSS wants virtual-hosted-style; s3.aimo.plus is not Aliyun → path-style.
    const isAliyunOSS =
      this.endpoint?.includes(this.region) === true || this.endpoint?.includes('aliyuncs') === true;
    const clientConfig: S3ClientConfig = { region: this.region };
    if (this.endpoint) {
      clientConfig.endpoint = this.endpoint;
      clientConfig.forcePathStyle = !isAliyunOSS;
    }
    if (cfg.accessKeyId && cfg.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      };
    }
    this.client = new S3Client(clientConfig);
    logger.info(
      `S3 adapter initialized: bucket=${this.bucket} prefix=${this.prefix} endpoint=${this.endpoint ?? 'AWS'} isPublic=${String(this.isPublic)}`,
    );
  }

  private full(key: string): string {
    return `${this.prefix}/${key}`.replaceAll(/\/+/g, '/');
  }

  private fullFor(key: string, metadata?: StorageMetadata): string {
    return `${this.prefixFrom(metadata)}/${key}`.replaceAll(/\/+/g, '/');
  }

  private bucketFrom(metadata?: StorageMetadata): string {
    return metadata?.bucket ?? this.bucket;
  }

  private prefixFrom(metadata?: StorageMetadata): string {
    return metadata?.prefix ?? this.prefix;
  }

  private is404(error: unknown): boolean {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
  }

  async uploadFile(key: string, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.full(key), Body: buffer }),
    );
  }

  async deleteFile(key: string, metadata?: StorageMetadata): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketFrom(metadata),
        Key: this.fullFor(key, metadata),
      }),
    );
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.full(key) }));
      return true;
    } catch (error) {
      if (this.is404(error)) return false;
      throw error;
    }
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.full(key) }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        lastModified: res.LastModified ?? new Date(),
      };
    } catch (error) {
      if (this.is404(error)) return null;
      throw error;
    }
  }

  async copyObject(srcKey: string, destKey: string, metadata?: StorageMetadata): Promise<void> {
    const bucket = this.bucketFrom(metadata);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${this.fullFor(srcKey, metadata)}`,
        Key: this.fullFor(destKey, metadata),
      }),
    );
  }

  async getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketFrom(metadata),
        Key: this.fullFor(key, metadata),
      }),
    );
    if (typeof res.ContentLength === 'number' && res.ContentLength > maxBytes) {
      abortS3Body(res.Body);
      throw new ObjectTooLargeError(key, maxBytes);
    }
    if (!res.Body) {
      throw new Error('S3 GetObject returned empty Body');
    }
    return readBodyWithLimit(res.Body as AsyncIterable<Uint8Array>, maxBytes, key);
  }

  async generateAccessUrl(
    key: string,
    metadata: StorageMetadata,
    expiresIn = 3600,
    signingDate?: Date,
  ): Promise<string> {
    const isPublic = metadata.isPublicBucket === 'true' ? true : this.isPublic;
    const fullKey = `${this.prefixFrom(metadata)}/${key}`.replaceAll(/\/+/g, '/');
    const bucket = this.bucketFrom(metadata);
    if (isPublic) {
      const domain = (metadata.endpoint ?? this.endpoint ?? '')
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
      if (domain) return `https://${bucket}.${domain}/${fullKey}`;
      return `https://${bucket}.s3.${metadata.region ?? this.region}.amazonaws.com/${fullKey}`;
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: fullKey,
        ResponseContentType: this.getContentType(fullKey),
      }),
      signingDate ? { expiresIn, signingDate } : { expiresIn },
    );
  }

  async presignPut(key: string, meta: PutMeta, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        ContentType: meta.contentType,
      }),
      { expiresIn },
    );
  }

  async initMultipart(key: string, meta: PutMeta): Promise<string> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        ContentType: meta.contentType,
      }),
    );
    if (!res.UploadId) throw new Error('S3 CreateMultipartUpload returned no UploadId');
    return res.UploadId;
  }

  async presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn },
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined = undefined;
    // ListParts paginates at 1000 entries per call.
    for (;;) {
      const res: ListPartsCommandOutput = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: this.full(key),
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const p of res.Parts ?? []) {
        if (p.PartNumber === undefined || p.Size === undefined) continue;
        parts.push({ partNumber: p.PartNumber, size: p.Size, etag: p.ETag ?? '' });
      }
      if (res.IsTruncated !== true || res.NextPartNumberMarker === undefined) break;
      marker = res.NextPartNumberMarker;
    }
    parts.sort((a, b) => a.partNumber - b.partNumber);
    return parts;
  }

  async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        UploadId: uploadId,
      }),
    );
  }
}
