import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseInOffscreen } from '../src/offscreen.js';

const sendMessage = vi.fn();
const getContexts = vi.fn();
const createDocument = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage,
    getURL: () => 'chrome-extension://id/offscreen.html',
    getContexts,
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
  },
  offscreen: {
    createDocument,
    Reason: { DOM_PARSER: 'DOM_PARSER', BLOBS: 'BLOBS' },
  },
});

const parsed = {
  title: 'T',
  extractedHtml: '<p>x</p>',
  extractedText: 'x',
  excerpt: 'x',
  byline: null,
  siteName: null,
  imageSrcs: ['https://ex.com/1.png'],
};

describe('parseInOffscreen', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    getContexts.mockReset();
    createDocument.mockReset();
    getContexts.mockResolvedValue([{}]);
  });

  it('sends a single mode and returns one ParsedArticle', async () => {
    sendMessage.mockResolvedValue(parsed);
    await expect(parseInOffscreen('<html>', 'https://ex.com/a', 'page')).resolves.toEqual(parsed);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'parse',
      target: 'offscreen',
      html: '<html>',
      url: 'https://ex.com/a',
      mode: 'page',
    });
    sendMessage.mockResolvedValue({ ...parsed, title: 'Article' });
    await expect(parseInOffscreen('<html>', 'https://ex.com/a', 'article')).resolves.toMatchObject({
      title: 'Article',
    });
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'parse',
      target: 'offscreen',
      html: '<html>',
      url: 'https://ex.com/a',
      mode: 'article',
    });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('rejects the old dual-parse bundle', async () => {
    sendMessage.mockResolvedValue({ article: parsed, page: parsed });
    await expect(parseInOffscreen('<html>', 'https://ex.com/a', 'article')).rejects.toThrow(
      'offscreen parse failed',
    );
  });
});
