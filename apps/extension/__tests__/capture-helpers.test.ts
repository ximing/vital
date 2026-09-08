import { describe, expect, it } from 'vitest';
import type { CapturePayload } from '../src/messages.js';
import {
  inboxInputFromCapture,
  inboxReaderUrl,
  saveToast,
  selectionInputFromCapture,
  taskNotesFromCapture,
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
