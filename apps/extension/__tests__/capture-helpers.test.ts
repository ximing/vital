import { describe, expect, it } from 'vitest';
import type { CapturePayload } from '../src/messages.js';
import {
  badgeText,
  feedbackView,
  inboxReaderUrl,
  inboxInputFromCapture,
  saveToast,
  savedAfterImagesToast,
  selectionInputFromCapture,
  taskNotesFromCapture,
  uploadProgressToast,
} from '../src/capture-helpers.js';

const capture: CapturePayload = {
  title: '文章标题',
  originalUrl: 'https://ex.com/a',
  extractedText: '正文',
  extractedHtml: '<p>正文</p>',
  excerpt: '旧摘',
  byline: '作者',
  siteName: 'Example',
  imageSrcs: ['https://ex.com/1.png'],
  selection: '一段<script>选区',
  tabId: 7,
  file: null,
};

describe('inboxReaderUrl', () => {
  it('opens the Vital reader, not the original page', () => {
    expect(inboxReaderUrl('http://localhost:5180/', 'item-1')).toBe(
      'http://localhost:5180/inbox/item-1',
    );
  });
});

describe('taskNotesFromCapture', () => {
  it('puts the page URL first and optional selection after', () => {
    expect(taskNotesFromCapture('https://ex.com/a')).toBe('https://ex.com/a');
    expect(taskNotesFromCapture('https://ex.com/a', '  选区  ')).toBe('https://ex.com/a\n\n选区');
  });
});

describe('saveToast', () => {
  it('distinguishes first save, duplicate, and task', () => {
    expect(saveToast('created')).toEqual({ text: '已保存到 Vital', actionLabel: '打开' });
    expect(saveToast('existing')).toEqual({
      text: '这篇已经在稍后读',
      actionLabel: '打开',
    });
    expect(saveToast('task')).toEqual({ text: '已保存为待办', actionLabel: '打开' });
  });
});

describe('save progress copy', () => {
  it('covers saving, upload n/N, done, and image failures', () => {
    expect(feedbackView({ type: 'saving' })).toEqual({ text: '正在保存…', badge: '…' });
    expect(uploadProgressToast(3, 12)).toBe('上传图片 3/12');
    expect(savedAfterImagesToast(0)).toBe('已保存');
    expect(savedAfterImagesToast(2)).toBe('已保存，2 张图失败');
  });

  it('fits the toolbar badge into four characters', () => {
    expect(badgeText('ok')).toBe('✓');
    expect(badgeText('fail')).toBe('!');
    expect(badgeText('progress', { done: 3, total: 12 })).toBe('3/12');
    expect(badgeText('progress', { done: 12, total: 12 }).length).toBeLessThanOrEqual(4);
    expect(feedbackView({ type: 'upload', done: 3, total: 12 })).toEqual({
      text: '上传图片 3/12',
      badge: '3/12',
    });
    expect(feedbackView({ type: 'imagesDone', failed: 0 })).toEqual({
      text: '已保存',
      badge: '✓',
    });
    expect(feedbackView({ type: 'imagesDone', failed: 2 })).toEqual({
      text: '已保存，2 张图失败',
      badge: '!',
    });
  });
});

describe('inboxInputFromCapture', () => {
  it('maps the article payload and lets a note replace the excerpt', () => {
    expect(inboxInputFromCapture(capture, '新标题', '备注')).toEqual({
      title: '新标题',
      originalUrl: 'https://ex.com/a',
      extractedText: '正文',
      extractedHtml: '<p>正文</p>',
      excerpt: '备注',
      byline: '作者',
      siteName: 'Example',
      source: 'extension',
    });
  });

  it('keeps the parsed excerpt when the note is empty', () => {
    expect(inboxInputFromCapture(capture, '新标题', '').excerpt).toBe('旧摘');
  });
});

describe('selectionInputFromCapture', () => {
  it('escapes the selection into one paragraph and drops article fields', () => {
    expect(selectionInputFromCapture(capture, '选区标题')).toEqual({
      title: '选区标题',
      originalUrl: 'https://ex.com/a',
      extractedText: '一段<script>选区',
      extractedHtml: '<p>一段&lt;script&gt;选区</p>',
      excerpt: '一段<script>选区',
      byline: null,
      siteName: 'Example',
      source: 'extension',
    });
  });
});
