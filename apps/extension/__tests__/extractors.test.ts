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
  it('captures the linked Zhihu answer, excluding question details and other answers', () => {
    const html = `<h1 class="QuestionHeader-title">团队冲突如何处理？</h1>
      <div class="QuestionRichText">问题描述，不是回答正文。这是提问者补充的背景信息，不能代替回答。显示全部</div>
      <div class="AnswerItem" name="1934631031434085454">
        <span class="AuthorInfo-name">其他作者</span>
        <div class="RichText"><p>推荐回答，不应保存。</p></div>
      </div>
      <div class="AnswerItem" name="1939319305469666412">
        <span class="AuthorInfo-name">目标作者</span>
        <div class="RichContent-inner"><span class="RichText ztext">
          <p>目标回答第一段：先了解双方的诉求，再讨论协作方式。</p>
          <p>目标回答最后一段。</p>
          <img data-src="https://pic.zhimg.com/answer.jpg" width="800" height="600" />
        </span></div>
        <div class="RichText">评论区不应保存。</div>
      </div>`;
    const parsed = parseArticle(html,
      'https://www.zhihu.com/question/1919551834101646324/answer/1939319305469666412');
    expect(parsed.title).toBe('团队冲突如何处理？');
    expect(parsed.byline).toBe('目标作者');
    expect(parsed.extractedText).toContain('目标回答第一段');
    expect(parsed.extractedText).toContain('目标回答最后一段');
    expect(parsed.extractedText).not.toMatch(/问题描述|推荐回答|评论区|显示全部/);
    expect(parsed.imageSrcs).toEqual(['https://pic.zhimg.com/answer.jpg']);
  });

  it('prefers Zhihu post content over earlier unrelated rich text', () => {
    const parsed = parseArticle(`<div class="RichText">导航和推荐内容不应保存，这是页面侧栏的其他内容，不是专栏文章。</div>
      <h1 class="Post-Title">专栏标题</h1>
      <div class="Post-RichTextContainer"><div class="Post-RichText">
        <p>专栏的完整正文，应当优先选择文章内容而不是页面其他富文本。</p>
      </div></div>`, 'https://zhuanlan.zhihu.com/p/123');
    expect(parsed.extractedText).toContain('专栏的完整正文');
    expect(parsed.extractedText).not.toContain('导航和推荐');
  });

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
