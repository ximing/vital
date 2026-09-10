import { describe, expect, it } from 'vitest';
import { envSchema } from '../../src/config.js';

const minimalEnv = {
  PG_HOST: 'localhost',
  PG_USER: 'vital',
  PG_PASSWORD: 'secret',
  PG_DATABASE: 'vital',
  JWT_SECRET: 'x'.repeat(32),
  COOKIE_SECRET: 'y'.repeat(32),
  ATTACHMENT_S3_BUCKET: 'bucket',
  ATTACHMENT_S3_ACCESS_KEY_ID: 'ak',
  ATTACHMENT_S3_SECRET_ACCESS_KEY: 'sk',
};

describe('retrieval config', () => {
  it('defaults everything to off with documented defaults', () => {
    const parsed = envSchema.parse(minimalEnv);
    expect(parsed.DASHSCOPE_API_KEY).toBeUndefined();
    expect(parsed.DASHSCOPE_BASE_URL).toBe('https://dashscope.aliyuncs.com/api/v1');
    expect(parsed.EMBEDDING_MODEL).toBe('qwen3-vl-embedding');
    expect(parsed.EMBEDDING_DIMENSIONS).toBe(2560);
    expect(parsed.RERANK_MODEL).toBe('qwen3.7-text-rerank');
    expect(parsed.QDRANT_URL).toBeUndefined();
    expect(parsed.QDRANT_API_KEY).toBeUndefined();
    expect(parsed.MEILI_URL).toBeUndefined();
    expect(parsed.MEILI_ADMIN_KEY).toBeUndefined();
    expect(parsed.RETRIEVAL_NAMESPACE).toBeUndefined();
  });

  it('parses provided values and coerces dimensions', () => {
    const parsed = envSchema.parse({
      ...minimalEnv,
      DASHSCOPE_API_KEY: 'sk-real',
      EMBEDDING_DIMENSIONS: '1024',
      QDRANT_URL: 'http://localhost:6333',
      QDRANT_API_KEY: 'qk',
      MEILI_URL: 'http://localhost:7700',
      MEILI_ADMIN_KEY: 'mk',
      RETRIEVAL_NAMESPACE: 'staging',
    });
    expect(parsed.DASHSCOPE_API_KEY).toBe('sk-real');
    expect(parsed.EMBEDDING_DIMENSIONS).toBe(1024);
    expect(parsed.QDRANT_URL).toBe('http://localhost:6333');
    expect(parsed.MEILI_ADMIN_KEY).toBe('mk');
    expect(parsed.RETRIEVAL_NAMESPACE).toBe('staging');
  });

  it('rejects an invalid RETRIEVAL_NAMESPACE', () => {
    expect(() => envSchema.parse({ ...minimalEnv, RETRIEVAL_NAMESPACE: 'Prod' })).toThrow();
    expect(() => envSchema.parse({ ...minimalEnv, RETRIEVAL_NAMESPACE: 'dev-1' })).toThrow();
  });

  it('rejects an invalid DASHSCOPE_BASE_URL', () => {
    expect(() => envSchema.parse({ ...minimalEnv, DASHSCOPE_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('rejects an empty DASHSCOPE_API_KEY', () => {
    expect(() => envSchema.parse({ ...minimalEnv, DASHSCOPE_API_KEY: '' })).toThrow();
  });
});
