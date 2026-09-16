import { describe, expect, it, vi } from 'vitest';
import type { CapturePayload } from '../src/messages.js';
import type { ParsedArticle } from '../src/parse-article.js';
import { modeLabels } from '../src/i18n.js';
import {
  createPageParseCache,
  ensurePageParsed,
  fileMetaLine,
  initialMode,
  metaLine,
  modeDisabled,
  progressLabel,
  savedLabel,
  titleForMode,
} from '../src/popup-state.js';

const capture: CapturePayload = {
  title: '文章标题',
  originalUrl: 'https://ex.com/a',
  extractedText: '正'.repeat(2000),
  extractedHtml: '<p>正文</p>',
  excerpt: null,
  byline: '作者',
  siteName: 'Example',
  imageSrcs: ['https://ex.com/1.png', 'https://ex.com/2.png'],
  rawHtml: '<html><body>整页</body></html>',
  selection: '一段选区',
  tabId: 7,
  file: null,
};

const pageParsed: ParsedArticle = {
  title: '整页标题',
  extractedHtml: '<div class="wrap"><p>整页正文</p><aside>侧栏</aside></div>',
  extractedText: '页'.repeat(80),
  excerpt: null,
  byline: null,
  siteName: 'Example',
  imageSrcs: ['https://ex.com/p.png'],
};

const file = { url: 'https://ex.com/v/clip.mp4', mime: 'video/mp4', size: 123 };

describe('modeLabels', () => {
  it('has Chinese labels and English titles for every mode', () => {
    expect(modeLabels.article).toEqual({ zh: '文章', en: 'Article' });
    expect(modeLabels.page).toEqual({ zh: '整页', en: 'Page' });
    expect(modeLabels.selection).toEqual({ zh: '选区', en: 'Selection' });
    expect(modeLabels.task).toEqual({ zh: '待办', en: 'Task' });
    expect(modeLabels.file).toEqual({ zh: '文件', en: 'File' });
  });
});

describe('initialMode / modeDisabled', () => {
  it('prefers file, then selection, then article', () => {
    expect(initialMode(capture)).toBe('selection');
    expect(initialMode({ ...capture, selection: '   ' })).toBe('article');
    expect(initialMode({ ...capture, file })).toBe('file');
    expect(initialMode({ ...capture, selection: '   ', file })).toBe('file');
    expect(modeDisabled('selection', { ...capture, selection: '' })).toBe(true);
    expect(modeDisabled('selection', { ...capture, selection: '   ' })).toBe(true);
    expect(modeDisabled('selection', { ...capture, selection: '有字' })).toBe(false);
    expect(modeDisabled('article', { ...capture, selection: '' })).toBe(false);
    expect(modeDisabled('page', capture)).toBe(false);
    expect(modeDisabled('page', { ...capture, rawHtml: null })).toBe(true);
    expect(modeDisabled('task', { ...capture, selection: '' })).toBe(false);
  });
});

describe('fileMetaLine', () => {
  it('shows kind and human-readable size', () => {
    expect(fileMetaLine({ mime: 'video/mp4', size: Math.round(12.3 * 1024 ** 2) })).toBe(
      '视频 · 12.3MB',
    );
    expect(fileMetaLine({ mime: 'audio/mpeg', size: 2048 })).toBe('音频 · 2KB');
    expect(fileMetaLine({ mime: 'application/pdf', size: 500 })).toBe('PDF · 500B');
  });
});

describe('titleForMode', () => {
  it('uses the parsed title for articles and clips the selection otherwise', () => {
    expect(titleForMode(capture, 'article')).toBe('文章标题');
    expect(titleForMode(capture, 'page')).toBe('文章标题');
    expect(titleForMode(capture, 'page', pageParsed)).toBe('整页标题');
    expect(titleForMode(capture, 'selection')).toBe('一段选区');
    expect(titleForMode({ ...capture, selection: '' }, 'task')).toBe('文章标题');
  });
});

describe('metaLine', () => {
  it('shows site, word count, and image count for articles', () => {
    expect(metaLine(capture, 'article')).toBe('Example · 2000 字 · 2 张图');
  });

  it('uses page text and images for page mode once parsed', () => {
    expect(metaLine(capture, 'page')).toBe('Example');
    expect(metaLine(capture, 'page', pageParsed)).toBe('Example · 80 字 · 1 张图');
  });

  it('falls back to hostname and hides empty parts', () => {
    const bare = { ...capture, siteName: null, extractedText: null, imageSrcs: [] };
    expect(metaLine(bare, 'article')).toBe('ex.com');
    expect(metaLine(capture, 'selection')).toBe('4 字');
  });
});

describe('ensurePageParsed', () => {
  it('requests once, reuses in-flight, then serves the cache', async () => {
    let resolve!: (value: ParsedArticle) => void;
    const request = vi.fn(
      () =>
        new Promise<ParsedArticle>((r) => {
          resolve = r;
        }),
    );
    const cache = createPageParseCache();
    const first = ensurePageParsed(cache, capture.rawHtml, capture.originalUrl, request);
    const second = ensurePageParsed(cache, capture.rawHtml, capture.originalUrl, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(capture.rawHtml, capture.originalUrl);
    resolve(pageParsed);
    expect(await first).toBe(pageParsed);
    expect(await second).toBe(pageParsed);
    expect(await ensurePageParsed(cache, capture.rawHtml, capture.originalUrl, request)).toBe(
      pageParsed,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('skips the request when rawHtml is null and retries after failure', async () => {
    const cache = createPageParseCache();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(pageParsed);
    expect(await ensurePageParsed(cache, null, capture.originalUrl, request)).toBeNull();
    expect(request).not.toHaveBeenCalled();
    await expect(
      ensurePageParsed(cache, capture.rawHtml, capture.originalUrl, request),
    ).rejects.toThrow('fail');
    expect(await ensurePageParsed(cache, capture.rawHtml, capture.originalUrl, request)).toBe(
      pageParsed,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('saved / progress labels', () => {
  it('reuses toast copy and appends image failures', () => {
    expect(savedLabel('task', 0)).toBe('已保存为待办');
    expect(savedLabel('existing', 0)).toBe('这篇已经在稍后读');
    expect(savedLabel('created', 0)).toBe('已保存到 Vital');
    expect(savedLabel('created', 2)).toBe('已保存，2 张图失败');
    expect(progressLabel(2, 5)).toBe('2/5');
  });
});
