import { clip } from './html.js';
import { promoteLazyImages } from './images.js';

export interface SiteExtract {
  title: string;
  html: string;
  text: string;
  byline: string | null;
  siteName: string | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function textOf(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function og(doc: Document, prop: string): string | null {
  const el =
    doc.querySelector(`meta[property="${prop}"]`) ?? doc.querySelector(`meta[name="${prop}"]`);
  const value = el?.getAttribute('content')?.trim();
  return value === undefined || value === '' ? null : value;
}

function pack(
  title: string,
  root: Element | null,
  extras?: { byline?: string | null; siteName?: string | null },
): SiteExtract | null {
  if (root !== null) promoteLazyImages(root);
  const html = root?.innerHTML.trim() ?? '';
  const text = textOf(root);
  const resolved = title.trim() === '' ? (clip(text, 80) ?? '') : title.trim();
  if (resolved === '' && html === '') return null;
  return {
    title: resolved === '' ? 'Untitled' : resolved,
    html: html === '' ? `<p>${text}</p>` : html,
    text,
    byline: extras?.byline ?? null,
    siteName: extras?.siteName ?? null,
  };
}

function wechat(doc: Document): SiteExtract | null {
  const title = textOf(doc.querySelector('#activity-name')) || og(doc, 'og:title') || '';
  const byline = textOf(doc.querySelector('#js_name')) || og(doc, 'og:article:author');
  const root = doc.querySelector('#js_content');
  return pack(title, root, { byline, siteName: byline });
}

function zhihu(doc: Document): SiteExtract | null {
  const title =
    textOf(doc.querySelector('h1.Post-Title, h1.QuestionHeader-title, h1')) ||
    og(doc, 'og:title') ||
    '';
  const byline = textOf(doc.querySelector('.AuthorInfo-name, meta[itemprop="name"]'));
  const root = doc.querySelector(
    '.Post-RichText, .Post-RichTextContainer, .RichText, .QuestionRichText, article',
  );
  return pack(title, root, { byline, siteName: '知乎' });
}

function xhs(doc: Document): SiteExtract | null {
  const title =
    og(doc, 'og:title') || textOf(doc.querySelector('#detail-title, .title, .note-title')) || '';
  const root = doc.querySelector('.note-content, #detail-desc, .desc, .note-text');
  const packed = pack(title, root, { siteName: og(doc, 'og:site_name') ?? '小红书' });
  if (packed === null) return null;
  const images = Array.from(
    doc.querySelectorAll(
      'img[src*="xhscdn"], img[src*="xiaohongshu"], .swiper-slide img, .note-slider img',
    ),
  );
  if (images.length === 0) return packed;
  promoteLazyImages(doc.body);
  const extras = images
    .map((img) => img.getAttribute('src'))
    .filter((src): src is string => typeof src === 'string' && src.startsWith('http'))
    .map((src) => `<p><img src="${src}"></p>`)
    .join('');
  if (extras === '') return packed;
  return { ...packed, html: `${packed.html}${extras}` };
}

function twitter(doc: Document): SiteExtract | null {
  const tweet = doc.querySelector('article[data-testid="tweet"]');
  if (tweet === null) {
    const title = og(doc, 'og:title') || og(doc, 'twitter:title') || '';
    return pack(title, doc.querySelector('article'), { siteName: 'X' });
  }
  promoteLazyImages(tweet);
  const text = textOf(tweet.querySelector('[data-testid="tweetText"]'));
  const title = clip(text, 80) ?? og(doc, 'og:title') ?? 'X';
  return {
    title,
    html: tweet.innerHTML,
    text,
    byline: null,
    siteName: 'X',
  };
}

export function extractSite(doc: Document, url: string): SiteExtract | null {
  const host = hostOf(url);
  if (host === 'mp.weixin.qq.com') return wechat(doc);
  if (host === 'zhihu.com' || host.endsWith('.zhihu.com')) return zhihu(doc);
  if (host.endsWith('xiaohongshu.com') || host.endsWith('xhslink.com')) return xhs(doc);
  if (
    host === 'x.com' ||
    host === 'twitter.com' ||
    host.endsWith('.x.com') ||
    host.endsWith('.twitter.com')
  ) {
    return twitter(doc);
  }
  return null;
}
