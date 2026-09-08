import { vi } from 'vitest';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { UnifiedStorageAdapter } from '../../src/storage/base.adapter.js';

export type MockStorage = {
  [K in keyof UnifiedStorageAdapter]: ReturnType<typeof vi.fn<UnifiedStorageAdapter[K]>>;
};

export function installMockStorage(): MockStorage {
  const mock: MockStorage = {
    uploadFile: vi.fn<UnifiedStorageAdapter['uploadFile']>().mockResolvedValue(undefined),
    deleteFile: vi.fn<UnifiedStorageAdapter['deleteFile']>().mockResolvedValue(undefined),
    fileExists: vi.fn<UnifiedStorageAdapter['fileExists']>().mockResolvedValue(false),
    headObject: vi.fn<UnifiedStorageAdapter['headObject']>().mockResolvedValue(null),
    copyObject: vi.fn<UnifiedStorageAdapter['copyObject']>().mockResolvedValue(undefined),
    generateAccessUrl: vi
      .fn<UnifiedStorageAdapter['generateAccessUrl']>()
      .mockResolvedValue('https://fake.local/presigned-get'),
    initMultipart: vi
      .fn<UnifiedStorageAdapter['initMultipart']>()
      .mockResolvedValue('fake-upload-id'),
    presignPart: vi
      .fn<UnifiedStorageAdapter['presignPart']>()
      .mockResolvedValue('https://fake.local/presigned-part'),
    listParts: vi.fn<UnifiedStorageAdapter['listParts']>().mockResolvedValue([]),
    completeMultipart: vi
      .fn<UnifiedStorageAdapter['completeMultipart']>()
      .mockResolvedValue(undefined),
    abortMultipart: vi.fn<UnifiedStorageAdapter['abortMultipart']>().mockResolvedValue(undefined),
    getObject: vi.fn<UnifiedStorageAdapter['getObject']>().mockResolvedValue(Buffer.alloc(0)),
  };
  setStorageAdapter(mock);
  return mock;
}
