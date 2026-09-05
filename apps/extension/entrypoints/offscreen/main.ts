import { isOffscreenParse } from '../../src/messages.js';
import { parseArticle } from '../../src/parse-article.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isOffscreenParse(message)) return;
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
});
