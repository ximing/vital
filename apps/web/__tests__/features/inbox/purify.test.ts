import { describe, expect, it } from 'vitest';
import { prepareReaderHtml, purifyInboxHtml, readerSourceHtml, textToHtml } from '../../../src/features/inbox/purify';

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
});

describe('readerSourceHtml', () => {
  it('falls back to escaped paragraphs', () => {
    expect(readerSourceHtml(null, 'a <b>\n\nb')).toBe('<p>a &lt;b&gt;</p><p>b</p>');
    expect(textToHtml('only')).toBe('<p>only</p>');
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
});
