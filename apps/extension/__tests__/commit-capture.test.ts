import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturePayload } from '../src/messages.js';
import type { ParsedArticle } from '../src/parse-article.js';

const { createInboxResult, parseInOffscreen, itemNeedingRehost } = vi.hoisted(() => ({
  createInboxResult: vi.fn(),
  parseInOffscreen: vi.fn(),
  itemNeedingRehost: vi.fn(),
}));

vi.mock('../src/client.js', () => ({
  getClient: () => ({ createInboxResult }),
}));

vi.mock('../src/offscreen.js', () => ({
  parseInOffscreen,
}));

vi.mock('../src/capture/image-pipeline.js', () => ({
  gatherImages: vi.fn(),
  itemNeedingRehost,
  rehostImages: vi.fn(),
  rehostDirectFile: vi.fn(),
  rehostWithFeedback: vi.fn(),
}));

import { commitCapture, pageParsedForCommit } from '../src/capture/save-flows.js';

const capture: CapturePayload = {
  title: '文章标题',
  originalUrl: 'https://ex.com/a',
  extractedText: '正文',
  extractedHtml: '<p>正文</p>',
  excerpt: '旧摘',
  byline: '作者',
  siteName: 'Example',
  imageSrcs: ['https://ex.com/1.png'],
  rawHtml: '<html><body>整页</body></html>',
  selection: '',
  tabId: 7,
  file: null,
};

const pageParsed: ParsedArticle = {
  title: '整页标题',
  extractedText: '整页正文',
  extractedHtml: '<div class="wrap"><p>整页正文</p></div>',
  excerpt: '整页正文',
  byline: null,
  siteName: 'Example',
  imageSrcs: ['https://ex.com/p.png'],
};

describe('pageParsedForCommit', () => {
  it('returns the cache and does not parse', async () => {
    const parse = vi.fn();
    await expect(pageParsedForCommit(capture, pageParsed, parse)).resolves.toBe(pageParsed);
    expect(parse).not.toHaveBeenCalled();
  });

  it('parses rawHtml when the cache is missing', async () => {
    const parse = vi.fn(async () => pageParsed);
    await expect(pageParsedForCommit(capture, undefined, parse)).resolves.toBe(pageParsed);
    expect(parse).toHaveBeenCalledWith(capture.rawHtml, capture.originalUrl, 'page');
  });

  it('returns an empty parse when rawHtml is null', async () => {
    const parse = vi.fn();
    const empty = await pageParsedForCommit({ ...capture, rawHtml: null }, undefined, parse);
    expect(parse).not.toHaveBeenCalled();
    expect(empty).toMatchObject({ title: '文章标题', extractedHtml: null, imageSrcs: [] });
  });
});

describe('commitCapture page mode', () => {
  beforeEach(() => {
    createInboxResult.mockReset();
    parseInOffscreen.mockReset();
    itemNeedingRehost.mockReset();
    itemNeedingRehost.mockResolvedValue(null);
    createInboxResult.mockImplementation(async (input: { title: string; originalUrl?: string }) => ({
      created: true,
      item: {
        id: 'item-1',
        title: input.title,
        outcomeId: null,
        originalUrl: input.originalUrl ?? null,
        canonicalUrl: input.originalUrl ?? null,
        extractedText: null,
        extractedHtml: null,
        excerpt: null,
        byline: null,
        siteName: null,
        status: 'unread',
        source: 'extension',
        capturedAt: '2026-01-01T00:00:00.000Z',
        readAt: null,
        convertedTaskId: null,
        tagIds: [],
        assets: [],
        deletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }));
  });

  it('uses pageParsed and does not re-parse', async () => {
    await commitCapture({
      capture,
      title: '新标题',
      note: '',
      mode: 'page',
      pageParsed,
    });
    expect(parseInOffscreen).not.toHaveBeenCalled();
    expect(createInboxResult).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '新标题',
        extractedText: '整页正文',
        extractedHtml: '<div class="wrap"><p>整页正文</p></div>',
        excerpt: '整页正文',
        byline: '作者',
        siteName: 'Example',
        source: 'extension',
      }),
      expect.any(String),
    );
  });

  it('falls back to offscreen page parse when pageParsed is omitted', async () => {
    parseInOffscreen.mockResolvedValue(pageParsed);
    await commitCapture({ capture, title: '新标题', note: '', mode: 'page' });
    expect(parseInOffscreen).toHaveBeenCalledWith(capture.rawHtml, capture.originalUrl, 'page');
    expect(createInboxResult).toHaveBeenCalledWith(
      expect.objectContaining({
        extractedText: '整页正文',
        extractedHtml: '<div class="wrap"><p>整页正文</p></div>',
      }),
      expect.any(String),
    );
  });

  it('does not page-parse on the article path', async () => {
    await commitCapture({ capture, title: '新标题', note: '', mode: 'article' });
    expect(parseInOffscreen).not.toHaveBeenCalled();
    expect(createInboxResult).toHaveBeenCalledWith(
      expect.objectContaining({
        extractedText: '正文',
        extractedHtml: '<p>正文</p>',
        excerpt: '旧摘',
      }),
      expect.any(String),
    );
  });
});
