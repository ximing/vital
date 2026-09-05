import { config } from '../config.js';
import { S3UnifiedStorageAdapter } from './s3.adapter.js';
import type { StorageMetadata, UnifiedStorageAdapter } from './base.adapter.js';

export type { StorageMetadata, UnifiedStorageAdapter } from './base.adapter.js';

let singleton: UnifiedStorageAdapter | null = null;
let override: UnifiedStorageAdapter | null = null;

export function getStorage(): UnifiedStorageAdapter {
  if (override) return override;
  if (!singleton) {
    const adapterCfg: ConstructorParameters<typeof S3UnifiedStorageAdapter>[0] = {
      bucket: config.ATTACHMENT_S3_BUCKET,
      prefix: config.ATTACHMENT_S3_PREFIX,
      region: config.ATTACHMENT_S3_REGION,
      accessKeyId: config.ATTACHMENT_S3_ACCESS_KEY_ID,
      secretAccessKey: config.ATTACHMENT_S3_SECRET_ACCESS_KEY,
      isPublic: config.ATTACHMENT_S3_IS_PUBLIC,
    };
    if (config.ATTACHMENT_S3_ENDPOINT) {
      adapterCfg.endpoint = config.ATTACHMENT_S3_ENDPOINT;
    }
    singleton = new S3UnifiedStorageAdapter(adapterCfg);
  }
  return singleton;
}

/** Test seam. Do not call from product code. */
export function setStorageAdapter(adapter: UnifiedStorageAdapter | null): void {
  override = adapter;
}

export function currentStorageMeta(): StorageMetadata {
  const meta: StorageMetadata = {
    bucket: config.ATTACHMENT_S3_BUCKET,
    prefix: config.ATTACHMENT_S3_PREFIX,
    region: config.ATTACHMENT_S3_REGION,
    isPublicBucket: config.ATTACHMENT_S3_IS_PUBLIC ? 'true' : 'false',
  };
  if (config.ATTACHMENT_S3_ENDPOINT) {
    meta.endpoint = config.ATTACHMENT_S3_ENDPOINT;
  }
  return meta;
}
