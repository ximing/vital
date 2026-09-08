import { describe, expect, it } from 'vitest';
import {
  isCommitPortMessage,
  isOffscreenParse,
  isPanelRequest,
  type CapturePayload,
} from '../src/messages.js';

const payload: CapturePayload = {
  title: '标题',
  originalUrl: 'https://ex.com/a',
  extractedText: null,
  extractedHtml: null,
  excerpt: null,
  byline: null,
  siteName: null,
  imageSrcs: [],
  selection: '',
  tabId: null,
};

describe('message guards', () => {
  it('accepts panel and offscreen shapes', () => {
    expect(isPanelRequest({ type: 'open-login' })).toBe(true);
    expect(isPanelRequest({ type: 'exchange-code', code: 'abc' })).toBe(true);
    expect(isPanelRequest({ type: 'login', email: 'a@b.c', password: 'x' })).toBe(false);
    expect(isPanelRequest({ type: 'nope' })).toBe(false);
    expect(
      isOffscreenParse({ type: 'parse', target: 'offscreen', html: '<p>', url: 'https://x' }),
    ).toBe(true);
    expect(isOffscreenParse({ type: 'parse', html: '<p>', url: 'https://x' })).toBe(false);
  });

  it('accepts capture-active-tab and commit port shapes', () => {
    expect(isPanelRequest({ type: 'capture-active-tab' })).toBe(true);
    expect(
      isCommitPortMessage({
        type: 'commit-capture',
        capture: payload,
        title: 't',
        note: '',
        mode: 'article',
      }),
    ).toBe(true);
    expect(
      isCommitPortMessage({
        type: 'commit-capture',
        capture: payload,
        title: 't',
        note: '',
        mode: 'nope',
      }),
    ).toBe(false);
    expect(
      isCommitPortMessage({ type: 'commit-capture', capture: null, title: '', note: '', mode: 'task' }),
    ).toBe(false);
  });
});
