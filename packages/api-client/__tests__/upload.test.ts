import { describe, expect, it } from 'vitest';
import { createVitalClient, ApiError, type TokenStore } from '../src/index.js';
import { bodyOf, respond, urlOf } from './test-helpers.js';

const tokenStore: TokenStore = {
  getAccessToken: () => 'a', getRefreshToken: () => 'r', setTokens: () => undefined, clear: () => undefined,
};

const PART = 5 * 1024 * 1024;

function s3Put(etag: string): Response {
  return new Response(null, { status: 200, headers: { ETag: etag } });
}

function makeClient(fetchImpl: typeof fetch) {
  return createVitalClient({ baseUrl: '', authMode: 'bearer', tokenStore, fetchImpl });
}

describe('upload (multipart)', () => {
  it('init → presign each part → PUT via injected fetch → complete with etags', async () => {
    const apiCalls: string[] = [];
    let s3PutCount = 0;
    const blob = new Blob([new Uint8Array(PART + 100)]); // 2 parts
    const client = makeClient((url, init) => {
      const u = urlOf(url);
      if (u.startsWith('https://s3')) {
        s3PutCount += 1;
        expect(init?.method).toBe('PUT');
        expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
        return Promise.resolve(s3Put(`"e${String(s3PutCount)}"`));
      }
      apiCalls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u === '/api/v1/uploads') {
        expect(bodyOf(init)).toMatchObject({ mime: 'application/pdf', size: blob.size });
        return respond(201, { id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 2, parts: [] });
      }
      if (u === '/api/v1/uploads/att1/parts/1' || u === '/api/v1/uploads/att1/parts/2') {
        return respond(200, { url: `https://s3${u}`, expiresIn: 900 });
      }
      if (u === '/api/v1/uploads/att1/complete') {
        const body = bodyOf(init) as { parts: Array<{ partNumber: number; etag: string }> };
        expect(body.parts).toEqual([
          { partNumber: 1, etag: '"e1"' },
          { partNumber: 2, etag: '"e2"' },
        ]);
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      return respond(200, {});
    });
    const res = await client.upload({ file: blob, mime: 'application/pdf', size: blob.size });
    expect(res.status).toBe('ready');
    expect(s3PutCount).toBe(2);
    expect(apiCalls).toEqual([
      'POST /api/v1/uploads',
      'POST /api/v1/uploads/att1/parts/1',
      'POST /api/v1/uploads/att1/parts/2',
      'POST /api/v1/uploads/att1/complete',
    ]);
  });

  it('resume skips uploaded parts and keeps their etags for complete', async () => {
    const blob = new Blob([new Uint8Array(PART + 100)]);
    const putPartNumbers: number[] = [];
    const progress: Array<[number, number]> = [];
    const client = makeClient((url, init) => {
      const u = urlOf(url);
      if (u.startsWith('https://s3')) {
        putPartNumbers.push(2);
        return Promise.resolve(s3Put('"e2"'));
      }
      if (u === '/api/v1/uploads') {
        expect(bodyOf(init)).toMatchObject({ resumeId: 'att1' });
        return respond(201, {
          id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 2,
          parts: [{ partNumber: 1, size: PART, etag: '"e1"' }],
        });
      }
      if (u === '/api/v1/uploads/att1/parts/2') {
        return respond(200, { url: 'https://s3/2', expiresIn: 900 });
      }
      if (u === '/api/v1/uploads/att1/complete') {
        const body = bodyOf(init) as { parts: Array<{ partNumber: number; etag: string }> };
        expect(body.parts).toEqual([
          { partNumber: 1, etag: '"e1"' }, // carried from init.parts
          { partNumber: 2, etag: '"e2"' },
        ]);
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      return respond(200, {});
    });
    const res = await client.upload({
      file: blob, mime: 'application/pdf', size: blob.size, resumeId: 'att1',
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });
    expect(res.status).toBe('ready');
    expect(putPartNumbers).toEqual([2]); // part 1 skipped
    // progress starts from the resumed base, not 0
    expect(progress[0]?.[0]).toBe(PART);
  });

  it('resume re-uploads parts whose server etag is empty', async () => {
    const blob = new Blob([new Uint8Array(PART + 100)]);
    const putPartNumbers: number[] = [];
    const progress: Array<[number, number]> = [];
    const client = makeClient((url, init) => {
      const u = urlOf(url);
      if (u.startsWith('https://s3')) {
        putPartNumbers.push(1);
        return Promise.resolve(s3Put('"e1-new"'));
      }
      if (u === '/api/v1/uploads') {
        return respond(201, {
          id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 2,
          // part 1 listed but etag-less (aborted mid-PUT): must be re-uploaded
          parts: [{ partNumber: 1, size: PART, etag: '' }, { partNumber: 2, size: 100, etag: '"e2"' }],
        });
      }
      if (u === '/api/v1/uploads/att1/parts/1') {
        return respond(200, { url: 'https://s3/1', expiresIn: 900 });
      }
      if (u === '/api/v1/uploads/att1/complete') {
        const body = bodyOf(init) as { parts: Array<{ partNumber: number; etag: string }> };
        expect(body.parts).toEqual([
          { partNumber: 1, etag: '"e1-new"' }, // fresh PUT etag, not the empty one
          { partNumber: 2, etag: '"e2"' },
        ]);
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      return respond(200, {});
    });
    const res = await client.upload({
      file: blob, mime: 'application/pdf', size: blob.size, resumeId: 'att1',
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });
    expect(res.status).toBe('ready');
    expect(putPartNumbers).toEqual([1]); // only the etag-less part
    // progress base counts only the part with a real etag
    expect(progress[0]?.[0]).toBe(100);
  });

  it('resume 409 falls back to a fresh init without resumeId', async () => {
    const blob = new Blob([new Uint8Array(10)]);
    let initCalls = 0;
    const client = makeClient((url, init) => {
      const u = urlOf(url);
      if (u === '/api/v1/uploads') {
        initCalls += 1;
        const body = bodyOf(init) as { resumeId?: string };
        if (initCalls === 1) {
          expect(body.resumeId).toBe('att-old');
          return respond(409, { error: { code: 'MEDIA_INVALID_STATE' } });
        }
        expect(body.resumeId).toBeUndefined();
        return respond(201, { id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 1, parts: [] });
      }
      if (u === '/api/v1/uploads/att1/parts/1') return respond(200, { url: 'https://s3/1', expiresIn: 900 });
      if (u === '/api/v1/uploads/att1/complete') {
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      if (u.startsWith('https://s3')) return Promise.resolve(s3Put('"e1"'));
      return respond(200, {});
    });
    const res = await client.upload({ file: blob, mime: 'application/pdf', size: blob.size, resumeId: 'att-old' });
    expect(res.status).toBe('ready');
    expect(initCalls).toBe(2);
  });

  it('partSource is used instead of file slicing', async () => {
    const requested: Array<[number, number]> = [];
    const blob = new Blob([new Uint8Array(PART + 100)]);
    const client = makeClient((url) => {
      const u = urlOf(url);
      if (u.startsWith('https://s3')) return Promise.resolve(s3Put('"e"'));
      if (u === '/api/v1/uploads') {
        return respond(201, { id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 2, parts: [] });
      }
      if (u.endsWith('/parts/1') || u.endsWith('/parts/2')) {
        return respond(200, { url: `https://s3${u}`, expiresIn: 900 });
      }
      if (u.endsWith('/complete')) {
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      return respond(200, {});
    });
    await client.upload({
      mime: 'application/pdf', size: blob.size,
      partSource: (start, end) => {
        requested.push([start, end]);
        return Promise.resolve(blob.slice(start, end));
      },
    });
    expect(requested).toEqual([[0, PART], [PART, PART + 100]]);
  });

  it('presigned PUT failure surfaces as ApiError and never completes', async () => {
    const blob = new Blob([new Uint8Array(10)]);
    let completed = false;
    const client = makeClient((url) => {
      const u = urlOf(url);
      if (u === '/api/v1/uploads') return respond(201, { id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 1, parts: [] });
      if (u.endsWith('/parts/1')) return respond(200, { url: 'https://s3/1', expiresIn: 900 });
      if (u.endsWith('/complete')) { completed = true; return respond(200, {}); }
      if (u.startsWith('https://s3')) return Promise.resolve(new Response(null, { status: 403 }));
      return respond(200, {});
    });
    await expect(
      client.upload({ file: blob, mime: 'application/pdf', size: blob.size }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(completed).toBe(false);
  });

  it('over 5GB fails client-side with 413 before any request', async () => {
    const client = makeClient(() => respond(200, {}));
    await expect(
      client.upload({ file: new Blob(), mime: 'video/mp4', size: 5 * 1024 ** 3 + 1 }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('non-whitelisted mime fails client-side with 422 before any request', async () => {
    const client = makeClient(() => respond(200, {}));
    await expect(
      client.upload({ file: new Blob(), mime: 'image/svg+xml', size: 10 }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
