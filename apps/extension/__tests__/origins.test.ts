import { describe, expect, it } from 'vitest';
import {
  DEFAULT_S3_ENDPOINT,
  LOCAL_API_URL,
  LOCAL_WEB_URL,
  STORE_ORIGIN,
  resolveExtensionOrigins,
} from '../origins';

describe('extension origins', () => {
  it('defaults local builds to localhost and leaves S3 on aimo.plus', () => {
    const origins = resolveExtensionOrigins({});
    expect(origins).toEqual({
      apiUrl: LOCAL_API_URL,
      webUrl: LOCAL_WEB_URL,
      s3: DEFAULT_S3_ENDPOINT,
      outDir: 'dist',
    });
    expect(origins.apiUrl).toContain('localhost');
    expect(origins.webUrl).toContain('localhost');
  });

  it('points the store target at vital.aimo.plus without mixing localhost', () => {
    const origins = resolveExtensionOrigins({ VITAL_EXTENSION_TARGET: 'store' });
    expect(origins.apiUrl).toBe(STORE_ORIGIN);
    expect(origins.webUrl).toBe(STORE_ORIGIN);
    expect(origins.s3).toBe(DEFAULT_S3_ENDPOINT);
    expect(origins.outDir).toBe('dist-store');
    expect(origins.apiUrl).not.toContain('localhost');
    expect(origins.webUrl).not.toContain('localhost');
  });

  it('lets explicit WXT_* env override the store/local target', () => {
    const origins = resolveExtensionOrigins({
      VITAL_EXTENSION_TARGET: 'store',
      WXT_API_URL: 'https://staging.example',
      WXT_WEB_URL: 'https://staging.example',
    });
    expect(origins.apiUrl).toBe('https://staging.example');
    expect(origins.webUrl).toBe('https://staging.example');
  });
});
