import { describe, expect, it } from 'vitest';
import type { CapturePayload } from '../src/messages.js';
import {
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
  selection: '一段选区',
  tabId: 7,
  file: null,
};

const file = { url: 'https://ex.com/v/clip.mp4', mime: 'video/mp4', size: 123 };

describe('initialMode / modeDisabled', () => {
  it('prefers file, then selection, then article', () => {
    expect(initialMode(capture)).toBe('selection');
    expect(initialMode({ ...capture, selection: '   ' })).toBe('article');
    expect(initialMode({ ...capture, file })).toBe('file');
    expect(initialMode({ ...capture, selection: '   ', file })).toBe('file');
    expect(modeDisabled('selection', '')).toBe(true);
    expect(modeDisabled('selection', '   ')).toBe(true);
    expect(modeDisabled('selection', '有字')).toBe(false);
    expect(modeDisabled('article', '')).toBe(false);
    expect(modeDisabled('task', '')).toBe(false);
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
    expect(titleForMode(capture, 'selection')).toBe('一段选区');
    expect(titleForMode({ ...capture, selection: '' }, 'task')).toBe('文章标题');
  });
});

describe('metaLine', () => {
  it('shows site, word count, and image count for articles', () => {
    expect(metaLine(capture, 'article')).toBe('Example · 2000 字 · 2 张图');
  });

  it('falls back to hostname and hides empty parts', () => {
    const bare = { ...capture, siteName: null, extractedText: null, imageSrcs: [] };
    expect(metaLine(bare, 'article')).toBe('ex.com');
    expect(metaLine(capture, 'selection')).toBe('4 字');
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
