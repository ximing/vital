import { describe, expect, it } from 'vitest';
import { inboxReaderUrl, saveToast, taskNotesFromCapture } from '../src/capture-helpers.js';

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
