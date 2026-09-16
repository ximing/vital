import { base64ToBytes, blobToBase64, convertRasterToJpeg } from '../../src/images.js';
import { isOffscreenConvert, isOffscreenParse } from '../../src/messages.js';
import { parseCapture } from '../../src/parse-article.js';

function emptyParsed(title: string) {
  return {
    title,
    extractedHtml: null,
    extractedText: null,
    excerpt: null,
    byline: null,
    siteName: null,
    imageSrcs: [] as string[],
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isOffscreenParse(message)) {
    try {
      sendResponse(parseCapture(message.html, message.url));
    } catch (err) {
      const empty = emptyParsed(message.url);
      sendResponse({
        article: empty,
        page: empty,
        error: err instanceof Error ? err.message : 'parse failed',
      });
    }
    return true;
  }
  if (isOffscreenConvert(message)) {
    void (async () => {
      try {
        const raw = base64ToBytes(message.data);
        const jpeg = await convertRasterToJpeg(raw);
        if (jpeg === null) {
          sendResponse({ mime: message.mime, data: message.data, error: 'convert failed' });
          return;
        }
        sendResponse({ mime: 'image/jpeg', data: await blobToBase64(jpeg) });
      } catch (err) {
        sendResponse({
          mime: message.mime,
          data: message.data,
          error: err instanceof Error ? err.message : 'convert failed',
        });
      }
    })();
    return true;
  }
  return undefined;
});
