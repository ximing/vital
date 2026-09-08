import { describe, expect, it } from 'vitest';
import type { CapturePayload } from '../src/messages.js';
import {
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
};

describe('initialMode / modeDisabled', () => {
  it('prefers selection when the page has one', () => {
    expect(initialMode('  一段选区  ')).toBe('selection');
    expect(initialMode('   ')).toBe('article');
    expect(modeDisabled('selection', '')).toBe(true);
    expect(modeDisabled('selection', '   ')).toBe(true);
    expect(modeDisabled('selection', '有字')).toBe(false);
    expect(modeDisabled('article', '')).toBe(false);
    expect(modeDisabled('task', '')).toBe(false);
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
    expect(progressLabel(2, 5)).toBe('转存图片 2/5');
  });
});
