import { describe, expect, it } from 'vitest';
import { imageSrcKeys } from '../src/image-src.js';

describe('imageSrcKeys', () => {
  it('matches WeChat srcs that differ by hash or query', () => {
    const keys = imageSrcKeys(
      'https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png&from=appmsg#imgIndex=2',
    );
    expect(keys).toContain(
      'https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png&from=appmsg',
    );
    expect(keys).toContain('https://mmbiz.qpic.cn/mmbiz_png/abc/640');
    expect(keys).toContain('mmbiz.qpic.cn/mmbiz_png/abc/640');
  });

  it('decodes HTML entities', () => {
    const keys = imageSrcKeys('https://mmbiz.qpic.cn/a/640?wx_fmt=png&amp;from=appmsg');
    expect(keys).toContain('https://mmbiz.qpic.cn/a/640?wx_fmt=png&from=appmsg');
  });
});
