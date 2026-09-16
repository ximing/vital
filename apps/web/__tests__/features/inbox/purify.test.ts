import { describe, expect, it } from 'vitest';
import {
  prepareReaderHtml,
  purifyInboxHtml,
  readerSourceHtml,
  textToHtml,
  tidyArticleHtml,
} from '../../../src/features/inbox/purify';

describe('purifyInboxHtml', () => {
  it('strips script and onerror', () => {
    const clean = purifyInboxHtml(
      '<p>safe</p><script>alert(1)</script><img src="https://x.test/a.png" onerror="alert(1)">',
    );
    expect(clean).toContain('safe');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onerror');
    expect(clean).toContain('https://x.test/a.png');
  });

  it('rejects javascript urls', () => {
    const clean = purifyInboxHtml('<a href="javascript:alert(1)">x</a>');
    expect(clean).not.toContain('javascript:');
  });

  it('strips data: URIs on img/video/source while keeping http(s)', () => {
    const clean = purifyInboxHtml(
      [
        '<p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="x"></p>',
        '<p><img src="https://ok.example/a.png" alt="ok"></p>',
        '<video src="data:video/mp4,aaaa" poster="data:image/gif,bb"></video>',
        '<video src="https://ok.example/a.mp4" poster="https://ok.example/p.jpg"></video>',
        '<picture><source src="data:image/webp,xx" type="image/webp"><source src="https://ok.example/a.webp" type="image/webp"></picture>',
      ].join(''),
    );
    expect(clean).not.toMatch(/src=["']data:/i);
    expect(clean).not.toMatch(/poster=["']data:/i);
    expect(clean).toContain('https://ok.example/a.png');
    expect(clean).toContain('https://ok.example/a.mp4');
    expect(clean).toContain('https://ok.example/p.jpg');
    expect(clean).toContain('https://ok.example/a.webp');
  });

  it('keeps table structure including colspan and rowspan', () => {
    const clean = purifyInboxHtml(
      '<table><caption>S</caption><thead><tr><th colspan="2" scope="col">H</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>',
    );
    expect(clean).toContain('<table');
    expect(clean).toContain('<caption>S</caption>');
    expect(clean).toContain('<thead>');
    expect(clean).toContain('<tbody>');
    expect(clean).toMatch(/colspan="2"/);
    expect(clean).toMatch(/rowspan="2"/);
    expect(clean).toContain('scope="col"');
    expect(clean).toContain('>A</td>');
    expect(clean).toContain('>B</td>');
    expect(clean).toContain('>C</td>');
  });

  it('keeps pre/code, sup/sub, details/summary, and dl', () => {
    const clean = purifyInboxHtml(
      '<pre><code>const x = 1;</code></pre><p>H<sub>2</sub>O x<sup>n</sup></p><details open><summary>More</summary><p>body</p></details><dl><dt>Term</dt><dd>Def</dd></dl>',
    );
    expect(clean).toContain('<pre>');
    expect(clean).toContain('<code>const x = 1;</code>');
    expect(clean).toContain('<sub>2</sub>');
    expect(clean).toContain('<sup>n</sup>');
    expect(clean).toContain('<details');
    expect(clean).toContain('open');
    expect(clean).toContain('<summary>More</summary>');
    expect(clean).toContain('<dl>');
    expect(clean).toContain('<dt>Term</dt>');
    expect(clean).toContain('<dd>Def</dd>');
  });

  it('strips event handlers and style while keeping the text', () => {
    const clean = purifyInboxHtml(
      '<p style="color:red" onclick="alert(1)" onmouseover="alert(2)">hi</p>',
    );
    expect(clean).toContain('hi');
    expect(clean).not.toContain('style=');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onmouseover');
    expect(clean).not.toContain('alert');
  });
});

describe('readerSourceHtml', () => {
  it('falls back to escaped paragraphs', () => {
    expect(readerSourceHtml(null, 'a <b>\n\nb')).toBe('<p>a &lt;b&gt;</p><p>b</p>');
    expect(textToHtml('only')).toBe('<p>only</p>');
  });
});

describe('tidyArticleHtml', () => {
  it('collapses WeChat empty wrappers so the reader is not full of blank lines', () => {
    const html = `<section><section>
      <span><br></span>
      <p><span><br></span></p>
      <p><span>正文。</span></p>
      <p><span><br></span></p>
      <img src="https://mmbiz.qpic.cn/a.png" alt="">
    </section></section>`;
    const out = tidyArticleHtml(html);
    expect(out).toContain('正文');
    expect(out).toContain('mmbiz.qpic.cn');
    expect((out.match(/<p>/g) ?? []).length).toBe(1);
    expect(out.match(/<br/g) ?? []).toEqual([]);
  });

  it('does not drop td/th that contain text, including chrome-token overlap', () => {
    const html =
      '<table><tr><th><span>列</span></th><th></th></tr><tr><td>关注</td><td><span>分享</span></td></tr></table>';
    const out = tidyArticleHtml(html);
    expect((out.match(/<th/g) ?? []).length).toBe(2);
    expect((out.match(/<td/g) ?? []).length).toBe(2);
    expect(out).toContain('列');
    expect(out).toContain('关注');
    expect(out).toContain('分享');
  });
});

describe('prepareReaderHtml chrome', () => {
  it('strips WeChat player chrome from already-saved HTML', async () => {
    const html = await prepareReaderHtml(
      `<p>3D样板间：消费者可以在场景中查看商品陈列效果</p>
       已关注 关注 重播 分享 赞 关闭观看更多
       大淘宝技术已关注分享视频，时长00:16
       您的浏览器不支持 video 标签
       <p>继续观看</p>
       <p>基于图像的三维重建技术。</p>`,
      null,
      [],
    );
    expect(html.html).toContain('3D样板间');
    expect(html.html).toContain('基于图像');
    expect(html.html).toContain('视频 · 00:16');
    expect(html.html).not.toMatch(/重播|您的浏览器不支持|继续观看/);
  });
});

describe('prepareReaderHtml', () => {
  it('rewrites asset images to server-signed URLs', async () => {
    const html = await prepareReaderHtml(
      '<p>hi</p><img src="https://x.test/a.png" alt="">',
      null,
      [
        {
          id: 'as1',
          attachmentId: '11111111-1111-4111-8111-111111111111',
          url: 'https://s3.test/signed-image',
          mime: 'image/jpeg',
          originalSrc: 'https://x.test/a.png',
          sortOrder: 0,
        },
      ],
    );
    expect(html.html).toContain('https://s3.test/signed-image');
    expect(html.html).toContain('hi');
    expect(html.objectUrls).toEqual([]);
  });

  it('maps WeChat originalSrc that differs by hash or query', async () => {
    const html = await prepareReaderHtml(
      '<p><img src="https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png&from=appmsg#imgIndex=2" alt=""></p>',
      null,
      [
        {
          id: 'as1',
          attachmentId: '11111111-1111-4111-8111-111111111111',
          url: 'https://s3.test/signed-image',
          mime: 'image/png',
          originalSrc: 'https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png',
          sortOrder: 0,
        },
      ],
    );
    expect(html.html).toContain('https://s3.test/signed-image');
    expect(html.html).not.toContain('mmbiz.qpic.cn');
  });

  it('rewrites video src to the signed asset URL', async () => {
    const html = await prepareReaderHtml(
      '<video src="https://cdn.ex.com/clip.mp4" poster="https://cdn.ex.com/p.jpg" controls></video>',
      null,
      [
        {
          id: 'as1',
          attachmentId: '11111111-1111-4111-8111-111111111111',
          url: 'https://s3.test/signed-video',
          mime: 'video/mp4',
          originalSrc: 'https://cdn.ex.com/clip.mp4',
          sortOrder: 0,
        },
        {
          id: 'as2',
          attachmentId: '22222222-2222-4222-8222-222222222222',
          url: 'https://s3.test/signed-poster',
          mime: 'image/jpeg',
          originalSrc: 'https://cdn.ex.com/p.jpg',
          sortOrder: 1,
        },
      ],
    );
    expect(html.html).toContain('https://s3.test/signed-video');
    expect(html.html).toContain('https://s3.test/signed-poster');
    expect(html.html).not.toContain('cdn.ex.com');
  });
});
