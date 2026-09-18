import { describe, expect, it } from 'vitest';
import { htmlToArticleDoc } from '../src/convert.js';
import { rebindDocMedia } from '../src/rebind.js';
import { uploadRefOf } from '../src/refs.js';
import type { ArticleDoc } from '../src/types.js';

const ATT = '0f9c2c1e-1111-4222-8333-444455556666';

describe('rebindDocMedia', () => {
  it('rewrites matched external srcs to upload refs', () => {
    const doc = htmlToArticleDoc(
      '<img src="https://mmbiz.qpic.cn/abc/640?wx_fmt=png">' +
        '<video src="https://cdn.example.com/v.mp4" poster="https://cdn.example.com/p.jpg"></video>' +
        '<img src="https://other.example.com/keep.png">',
    );
    const rebound = rebindDocMedia(doc, [
      { attachmentId: ATT, originalSrc: 'https://mmbiz.qpic.cn/abc/640?wx_fmt=png' },
      { attachmentId: '1f9c2c1e-1111-4222-8333-444455556666', originalSrc: 'https://cdn.example.com/v.mp4' },
      { attachmentId: '2f9c2c1e-1111-4222-8333-444455556666', originalSrc: 'https://cdn.example.com/p.jpg' },
    ]);
    const [img, video, keep] = rebound.content;
    expect(img).toMatchObject({ type: 'image', attrs: { src: uploadRefOf(ATT) } });
    expect(video).toMatchObject({
      type: 'video',
      attrs: {
        src: uploadRefOf('1f9c2c1e-1111-4222-8333-444455556666'),
        poster: uploadRefOf('2f9c2c1e-1111-4222-8333-444455556666'),
      },
    });
    expect(keep).toMatchObject({ type: 'image', attrs: { src: 'https://other.example.com/keep.png' } });
  });

  it('matches query-stripped and protocol-relative variants via imageSrcKeys', () => {
    const doc = htmlToArticleDoc('<img src="https://cdn.example.com/a.png?x=1&amp;y=2#frag">');
    const rebound = rebindDocMedia(doc, [
      { attachmentId: ATT, originalSrc: 'https://cdn.example.com/a.png?x=1&y=2' },
    ]);
    expect(rebound.content[0]).toMatchObject({ type: 'image', attrs: { src: uploadRefOf(ATT) } });
  });

  it('keeps already-bound refs and returns the same doc when nothing changes', () => {
    const doc: ArticleDoc = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: uploadRefOf(ATT) } }],
    };
    const rebound = rebindDocMedia(doc, [{ attachmentId: ATT, originalSrc: 'https://x.com/a.png' }]);
    expect(rebound).toBe(doc);
  });

  it('rebinds media nested in lists and tables', () => {
    const doc = htmlToArticleDoc(
      '<ul><li><img src="https://cdn.example.com/a.png"></li></ul>' +
        '<table><tr><td><img src="https://cdn.example.com/b.png"></td></tr></table>',
    );
    const rebound = rebindDocMedia(doc, [
      { attachmentId: ATT, originalSrc: 'https://cdn.example.com/a.png' },
      { attachmentId: '1f9c2c1e-1111-4222-8333-444455556666', originalSrc: 'https://cdn.example.com/b.png' },
    ]);
    expect(JSON.stringify(rebound)).toContain(uploadRefOf(ATT));
    expect(JSON.stringify(rebound)).toContain(
      uploadRefOf('1f9c2c1e-1111-4222-8333-444455556666'),
    );
  });

  it('is a no-op without assets', () => {
    const doc = htmlToArticleDoc('<img src="https://cdn.example.com/a.png">');
    expect(rebindDocMedia(doc, [])).toBe(doc);
  });
});
