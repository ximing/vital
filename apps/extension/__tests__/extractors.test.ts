/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { extractSite } from '../src/extractors.js';
import { parseArticle } from '../src/parse-article.js';

describe('extractSite', () => {
  it('pulls WeChat title and #js_content, promoting data-src images', () => {
    const html = `<!doctype html>
      <html><body>
        <h1 id="activity-name">  微信标题  </h1>
        <div id="js_name">某公众号</div>
        <div id="js_content">
          <p>正文第一段足够长用来当稍后读。</p>
          <img data-src="https://mmbiz.qpic.cn/hero.jpg" />
        </div>
      </body></html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const extracted = extractSite(doc, 'https://mp.weixin.qq.com/s/abc');
    expect(extracted?.title).toBe('微信标题');
    expect(extracted?.siteName).toBe('某公众号');
    expect(extracted?.html).toContain('正文第一段');
    expect(extracted?.html).toContain('https://mmbiz.qpic.cn/hero.jpg');
  });

  it('pulls Zhihu article title and rich text', () => {
    const html = `<!doctype html>
      <html><body>
        <h1 class="Post-Title">知乎长文</h1>
        <div class="Post-Author">作者甲</div>
        <div class="Post-RichText"><p>${'知乎正文。'.repeat(20)}</p></div>
      </body></html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const extracted = extractSite(doc, 'https://zhuanlan.zhihu.com/p/1');
    expect(extracted?.title).toBe('知乎长文');
    expect(extracted?.html).toContain('知乎正文');
  });

  it('pulls Xiaohongshu og title and note text', () => {
    const html = `<!doctype html>
      <html>
        <head>
          <meta property="og:title" content="笔记标题" />
          <meta property="og:site_name" content="小红书" />
        </head>
        <body>
          <div class="note-content"><p>笔记正文一段。</p></div>
          <img src="https://sns-img-qc.xhscdn.com/a.jpg" width="800" height="800" />
        </body>
      </html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const extracted = extractSite(doc, 'https://www.xiaohongshu.com/explore/1');
    expect(extracted?.title).toBe('笔记标题');
    expect(extracted?.siteName).toBe('小红书');
    expect(extracted?.html).toContain('笔记正文');
  });

  it('pulls the first X/Twitter tweet text', () => {
    const html = `<!doctype html>
      <html><body>
        <article data-testid="tweet">
          <div data-testid="tweetText">今天天气很好</div>
          <img src="https://pbs.twimg.com/media/abc.jpg" width="600" height="400" />
        </article>
      </body></html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const extracted = extractSite(doc, 'https://x.com/user/status/1');
    expect(extracted?.title).toBe('今天天气很好');
    expect(extracted?.html).toContain('今天天气很好');
    expect(extracted?.html).toContain('pbs.twimg.com');
  });

  it('returns null on unknown hosts so Readability can run', () => {
    const doc = new DOMParser().parseFromString('<html><body><p>x</p></body></html>', 'text/html');
    expect(extractSite(doc, 'https://news.example.com/a')).toBeNull();
  });
});

describe('parseArticle site extractors', () => {
  it('prefers the WeChat extractor over Readability chrome', () => {
    const html = `<!doctype html>
      <html>
        <head><title>微信</title></head>
        <body>
          <nav>导航要丢掉</nav>
          <h1 id="activity-name">正文标题</h1>
          <div id="js_content"><p>${'微信正文段落。'.repeat(12)}</p></div>
        </body>
      </html>`;
    const parsed = parseArticle(html, 'https://mp.weixin.qq.com/s/xyz');
    expect(parsed.title).toBe('正文标题');
    expect(parsed.extractedHtml).toContain('微信正文段落');
    expect(parsed.extractedHtml).not.toContain('导航要丢掉');
  });
});
