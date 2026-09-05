import { MAX_IMAGE_BYTES } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  createVitalClient,
  type PutFn,
  type TokenStore,
  type VitalClientOptions,
} from './index.js';
import { respond, urlOf } from './test-helpers.js';

const tokenStore: TokenStore = {
  getAccessToken: () => 'a',
  getRefreshToken: () => 'r',
  setTokens: () => undefined,
  clear: () => undefined,
};

function makeClient(opts: { put?: PutFn; fetchImpl: typeof fetch }) {
  const options: VitalClientOptions = {
    baseUrl: '',
    authMode: 'bearer',
    tokenStore,
    fetchImpl: opts.fetchImpl,
  };
  if (opts.put !== undefined) {
    options.putWithProgress = opts.put;
  }
  return createVitalClient(options);
}

describe('upload', () => {
  it('presign → bare PUT → complete; S3 URL never goes through Http', async () => {
    const progress: [number, number][] = [];
    const ids: string[] = [];
    const apiUrls: string[] = [];
    const putUrls: string[] = [];
    const put: PutFn = (url, _body, contentType, onProgress) => {
      putUrls.push(url);
      expect(contentType).toBe('image/jpeg');
      onProgress?.(1, 5);
      onProgress?.(5, 5);
      return Promise.resolve({ etag: '"e1"' });
    };
    const blob = new Blob(['hello']);
    const client = makeClient({
      put,
      fetchImpl: (url, init) => {
        const u = urlOf(url);
        apiUrls.push(`${init?.method ?? 'GET'} ${u}`);
        expect(u.startsWith('https://s3')).toBe(false);
        if (u === '/api/v1/uploads/presign') {
          return respond(201, { id: 'att1', method: 'put', url: 'https://s3/put', expiresIn: 900 });
        }
        if (u === '/api/v1/uploads/att1/complete') {
          return respond(200, {
            id: 'att1',
            status: 'ready',
            mime: 'image/jpeg',
            size: blob.size,
            ownerType: 'tmp',
          });
        }
        return respond(200, {});
      },
    });
    const res = await client.upload({
      file: blob,
      mime: 'image/jpeg',
      size: blob.size,
      onProgress: (loaded, total) => progress.push([loaded, total]),
      onAttachmentId: (id) => {
        expect(putUrls.length).toBe(0);
        ids.push(id);
      },
    });
    expect(res.status).toBe('ready');
    expect(putUrls).toEqual(['https://s3/put']);
    expect(apiUrls).toEqual(['POST /api/v1/uploads/presign', 'POST /api/v1/uploads/att1/complete']);
    expect(ids).toEqual(['att1']);
    expect(progress.at(-1)).toEqual([5, 5]);
  });

  it('rejects oversize locally without fetching', async () => {
    let fetches = 0;
    const client = makeClient({
      put: () => Promise.resolve({ etag: null }),
      fetchImpl: () => {
        fetches += 1;
        return respond(200, {});
      },
    });
    await expect(
      client.upload({ file: new Blob(['x']), mime: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 }),
    ).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE', status: 413 });
    expect(fetches).toBe(0);
  });

  it('rejects SVG locally', async () => {
    const client = makeClient({
      put: () => Promise.resolve({ etag: null }),
      fetchImpl: () => respond(200, {}),
    });
    await expect(
      client.upload({ file: new Blob(['x']), mime: 'image/svg+xml', size: 10 }),
    ).rejects.toMatchObject({ code: 'MEDIA_MISMATCH', status: 422 });
  });

  it('onAttachmentId still fires if PUT fails', async () => {
    const ids: string[] = [];
    const client = makeClient({
      put: () => Promise.reject(new ApiError(0, 'NETWORK_ERROR', '抖动')),
      fetchImpl: (url) => {
        if (urlOf(url) === '/api/v1/uploads/presign') {
          return respond(201, { id: 'att1', method: 'put', url: 'https://s3/put', expiresIn: 900 });
        }
        return respond(200, {});
      },
    });
    await expect(
      client.upload({
        file: new Blob(['x']),
        mime: 'image/jpeg',
        size: 1,
        onAttachmentId: (id) => ids.push(id),
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(ids).toEqual(['att1']);
  });
});
