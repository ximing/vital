import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { fetchUploadUrl, uploadIdOf, uploadIdsOf, useUploadUrls } from '../../../src/features/reports/upload-url';

vi.mock('@/api/client', () => ({
  client: { getUploadUrl: vi.fn() },
}));

const getUploadUrl = vi.mocked(client.getUploadUrl);

function uuid(n: string): string {
  return `${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
}

const ID_A = uuid('a');
const ID_B = uuid('b');
const ID_C = uuid('c');
const ID_D = uuid('d');
const ID_E = uuid('e');

beforeEach(() => {
  getUploadUrl.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('uploadIdsOf', () => {
  it('extracts and dedups upload ids from markdown refs', () => {
    const md = [
      `![shot](/api/v1/uploads/${ID_A})`,
      `![again](/api/v1/uploads/${ID_A})`,
      `[file](/api/v1/uploads/${ID_B})`,
      '![remote](https://example.com/cat.png)',
      'plain text',
    ].join('\n');
    expect(uploadIdsOf(md)).toEqual([ID_A, ID_B]);
  });

  it('returns empty for content without upload refs', () => {
    expect(uploadIdsOf('# title\n\ntext only')).toEqual([]);
  });
});

describe('uploadIdOf', () => {
  it('extracts the id from a single upload ref', () => {
    expect(uploadIdOf(`/api/v1/uploads/${ID_A}`)).toBe(ID_A);
  });

  it('returns null for non-upload refs', () => {
    expect(uploadIdOf('https://example.com/a.png')).toBeNull();
    expect(uploadIdOf('/api/v1/uploads/not-a-uuid')).toBeNull();
  });
});

describe('fetchUploadUrl', () => {
  it('resolves via the client and caches per id', async () => {
    getUploadUrl.mockResolvedValue({ url: 'https://signed.example/a', expiresIn: 21600 });
    await expect(fetchUploadUrl(ID_A)).resolves.toBe('https://signed.example/a');
    await expect(fetchUploadUrl(ID_A)).resolves.toBe('https://signed.example/a');
    expect(getUploadUrl).toHaveBeenCalledTimes(1);
    expect(getUploadUrl).toHaveBeenCalledWith(ID_A);
  });

  it('refetches after the cached url expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T08:00:00Z'));
    getUploadUrl.mockResolvedValueOnce({ url: 'https://signed.example/b1', expiresIn: 2 });
    await expect(fetchUploadUrl(ID_B)).resolves.toBe('https://signed.example/b1');
    vi.setSystemTime(new Date('2026-09-08T08:00:03Z'));
    getUploadUrl.mockResolvedValueOnce({ url: 'https://signed.example/b2', expiresIn: 2 });
    await expect(fetchUploadUrl(ID_B)).resolves.toBe('https://signed.example/b2');
    expect(getUploadUrl).toHaveBeenCalledTimes(2);
  });
});

describe('useUploadUrls', () => {
  it('resolves ids found in live markdown and omits failures', async () => {
    getUploadUrl.mockImplementation(async (id: string) => {
      if (id === ID_D) return { url: 'https://signed.example/d', expiresIn: 21600 };
      throw new Error('boom');
    });
    const { result } = renderHook(() => useUploadUrls(`![x](/api/v1/uploads/${ID_D}) [y](/api/v1/uploads/${ID_C})`));
    expect(result.current).toEqual({});
    await waitFor(() => {
      expect(result.current).toEqual({ [ID_D]: 'https://signed.example/d' });
    });
    // ID_C failed to resolve and stays absent.
    expect(result.current[ID_C]).toBeUndefined();
  });

  it('serves cached ids without refetching', async () => {
    getUploadUrl.mockResolvedValue({ url: 'https://signed.example/e', expiresIn: 21600 });
    await fetchUploadUrl(ID_E);
    getUploadUrl.mockClear();
    const { result } = renderHook(() => useUploadUrls(`![x](/api/v1/uploads/${ID_E})`));
    await waitFor(() => {
      expect(result.current).toEqual({ [ID_E]: 'https://signed.example/e' });
    });
    expect(getUploadUrl).not.toHaveBeenCalled();
  });

  it('picks up newly inserted ids when the markdown changes', async () => {
    getUploadUrl.mockResolvedValue({ url: 'https://signed.example/b', expiresIn: 21600 });
    const { result, rerender } = renderHook(({ md }: { md: string }) => useUploadUrls(md), {
      initialProps: { md: 'no refs yet' },
    });
    expect(result.current).toEqual({});
    rerender({ md: `![x](/api/v1/uploads/${ID_B})` });
    await waitFor(() => {
      expect(result.current).toEqual({ [ID_B]: 'https://signed.example/b' });
    });
  });
});
