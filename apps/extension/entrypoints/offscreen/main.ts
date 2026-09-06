import { base64ToBytes, blobToBase64, convertRasterToJpeg } from '../../src/images.js';
import { isOffscreenConvert, isOffscreenParse } from '../../src/messages.js';
import { parseArticle } from '../../src/parse-article.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isOffscreenParse(message)) {
    try {
      sendResponse(parseArticle(message.html, message.url));
    } catch (err) {
      sendResponse({
        title: message.url,
        extractedHtml: null,
        extractedText: null,
        excerpt: null,
        byline: null,
        siteName: null,
        imageSrcs: [],
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
