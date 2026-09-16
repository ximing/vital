import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from '@/lib/fetch-all-pages';

describe('fetchAllPages', () => {
  it('walks cursors until nextCursor is null', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [3], nextCursor: null });

    await expect(fetchAllPages(loadPage)).resolves.toEqual([1, 2, 3]);
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(loadPage).toHaveBeenNthCalledWith(1, undefined);
    expect(loadPage).toHaveBeenNthCalledWith(2, 'c1');
  });

  it('stops at maxPages even if the cursor continues', async () => {
    const loadPage = vi.fn(async (cursor: string | undefined) => ({
      items: [cursor ?? 'start'],
      nextCursor: 'more',
    }));

    const items = await fetchAllPages(loadPage, 3);
    expect(items).toEqual(['start', 'more', 'more']);
    expect(loadPage).toHaveBeenCalledTimes(3);
  });
});
