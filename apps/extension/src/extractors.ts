import { clip } from './html.js';
import { promoteMedia } from './images.js';

/**
 * Site extractors are a declarative registry. `extractSite` returns the first
 * match; later entries never run once one `match`s.
 *
 * To add a site:
 * 1. Implement `SiteExtractor`: `match(host, url)` (host is already lowercased)
 *    and `extract(doc, url)` returning `SiteExtract | null`. Reuse `pack` /
 *    `promoteMedia` when the page has a clear content root.
 * 2. Append the extractor to `SITE_EXTRACTORS` (order matters: first hit wins).
 * 3. Cover the host with a fixture in `__tests__/extractors.test.ts`.
 * Do not special-case hosts inside `extractSite` itself.
 */
export interface SiteExtract {
  title: string;
  html: string;
  text: string;
  byline: string | null;
  siteName: string | null;
}

export interface SiteExtractor {
  name: string;
  match(host: string, url: string): boolean;
  extract(doc: Document, url: string): SiteExtract | null;
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

export function pack(
  title: string,
  root: Element | null,
  extras?: { byline?: string | null; siteName?: string | null },
  pageUrl?: string,
): SiteExtract | null {
  if (root !== null) promoteMedia(root, pageUrl);
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

const VIDEO_SEED =
  'video, iframe.video_iframe, iframe[data-mpvid], iframe[data-vid], iframe[src*="v.qq.com"], iframe[data-src*="v.qq.com"], iframe[src*="video_tmpl"], iframe[data-src*="video_tmpl"], iframe[src*="videoplayer"], iframe[data-src*="videoplayer"], mp-common-videosnap, mp-common-mpvideo, .js_video, [id^="js_tx_video"]';

const PLAYER_CHROME_RE =
  /已关注|重播|退出全屏|切换到竖屏全屏|切换到横屏模式|继续播放进度条，百分之\d+|继续播放|继续观看|您的浏览器不支持\s*video\s*标签|倍速播放中|写下你的评论|已同步到看一看|视频详情|观看更多|点赞|在看|原创[,，]?|0\/0|进度条，百分之\d+|0\.5倍|0\.75倍|1\.0倍|1\.5倍|2\.0倍|倍速|全屏|高清|流畅|播放|分享|关闭|时长\s*\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}\/\d{1,2}:\d{2}|关注/g;

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function httpUrl(raw: string | null | undefined, pageUrl: string): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return null;
  try {
    const abs = new URL(trimmed, pageUrl);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
    abs.hash = '';
    return abs.href;
  } catch {
    return null;
  }
}

function residualLen(el: Element): number {
  const text = (el.textContent ?? '').replace(PLAYER_CHROME_RE, '').replace(/\s+/g, '');
  return text.length;
}

function playerShell(seed: Element, limit: Element): Element {
  let cur: Element | null = seed;
  let best = seed;
  while (cur !== null && cur !== limit && limit.contains(cur)) {
    if (residualLen(cur) > 20) break;
    best = cur;
    cur = cur.parentElement;
  }
  return best;
}

function videoCardHtml(shell: Element, pageUrl: string): string {
  const iframe = shell.matches('iframe') ? shell : shell.querySelector('iframe');
  const video = shell.matches('video') ? shell : shell.querySelector('video');
  const snap = shell.matches('mp-common-videosnap')
    ? shell
    : shell.querySelector('mp-common-videosnap');
  const poster =
    httpUrl(iframe?.getAttribute('data-cover'), pageUrl) ??
    httpUrl(video?.getAttribute('poster'), pageUrl) ??
    httpUrl(snap?.getAttribute('data-url'), pageUrl) ??
    httpUrl(shell.getAttribute('data-cover'), pageUrl) ??
    httpUrl(shell.querySelector('img')?.getAttribute('src'), pageUrl);
  const videoSrc =
    httpUrl(video?.getAttribute('src'), pageUrl) ??
    httpUrl(video?.querySelector('source')?.getAttribute('src'), pageUrl);
  const href =
    httpUrl(iframe?.getAttribute('data-src') ?? iframe?.getAttribute('src'), pageUrl) ?? pageUrl;
  const blob = shell.textContent ?? '';
  const duration =
    blob.match(/时长\s*(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1] ??
    blob.match(/\d{1,2}:\d{2}\/(\d{1,2}:\d{2})/)?.[1] ??
    null;
  const caption = duration !== null ? `视频 · ${duration}` : '视频';
  const cap = `<figcaption>${caption}</figcaption>`;
  if (videoSrc !== null) {
    const posterAttr = poster !== null ? ` poster="${escapeAttr(poster)}"` : '';
    return `<figure><video src="${escapeAttr(videoSrc)}"${posterAttr} controls playsinline></video>${cap}</figure>`;
  }
  if (poster !== null) {
    return `<figure><a href="${escapeAttr(href)}"><img src="${escapeAttr(poster)}" alt="视频封面"></a>${cap}</figure>`;
  }
  return `<p><a href="${escapeAttr(href)}">${caption}</a></p>`;
}

function replaceWeChatVideos(root: Element, pageUrl: string): void {
  const seeds = [...root.querySelectorAll(VIDEO_SEED)];
  const shells: Element[] = [];
  for (const seed of seeds) {
    const shell = playerShell(seed, root);
    if (!shells.some((seen) => seen === shell || seen.contains(shell))) shells.push(shell);
  }
  const outermost = shells.filter((el) => !shells.some((other) => other !== el && other.contains(el)));
  for (const shell of outermost) {
    const wrap = root.ownerDocument.createElement('div');
    wrap.innerHTML = videoCardHtml(shell, pageUrl);
    const node = wrap.firstElementChild;
    if (node !== null) shell.replaceWith(node);
    else shell.remove();
  }
}

function wechat(doc: Document, url: string): SiteExtract | null {
  const title = textOf(doc.querySelector('#activity-name')) || og(doc, 'og:title') || '';
  const byline = textOf(doc.querySelector('#js_name')) || og(doc, 'og:article:author');
  const root = doc.querySelector('#js_content');
  if (root !== null) {
    promoteMedia(root, url);
    replaceWeChatVideos(root, url);
  }
  return pack(title, root, { byline, siteName: byline }, url);
}

function zhihu(doc: Document, url: string): SiteExtract | null {
  const title =
    textOf(doc.querySelector('h1.Post-Title, h1.QuestionHeader-title, h1')) ||
    og(doc, 'og:title') ||
    '';
  // A selector list uses document order, not selector priority. Question details
  // precede the answer, and recommendations can contain other AnswerItems.
  const answerId = new URL(url).pathname.match(/\/answer\/(\d+)(?:\/|$)/)?.[1];
  const answer = answerId === undefined
    ? doc.querySelector('.AnswerItem')
    : doc.querySelector(`.AnswerItem[name="${answerId}"]`);
  if (answerId !== undefined && answer === null) return null;
  const authorScope = answer ?? doc;
  const byline = textOf(authorScope.querySelector('.AuthorInfo-name')) ||
    authorScope.querySelector('meta[itemprop="name"]')?.getAttribute('content') || null;
  const root = answer !== null
    ? answer.querySelector('.RichContent-inner .RichText') ?? answer.querySelector('.RichText')
    : doc.querySelector('.Post-RichText') ??
      doc.querySelector('.Post-RichTextContainer') ??
      doc.querySelector('article');
  return pack(title, root, { byline, siteName: '知乎' }, url);
}

function xhs(doc: Document, url: string): SiteExtract | null {
  const title =
    og(doc, 'og:title') || textOf(doc.querySelector('#detail-title, .title, .note-title')) || '';
  const root = doc.querySelector('.note-content, #detail-desc, .desc, .note-text');
  const packed = pack(title, root, { siteName: og(doc, 'og:site_name') ?? '小红书' }, url);
  if (packed === null) return null;
  const images = Array.from(
    doc.querySelectorAll(
      'img[src*="xhscdn"], img[src*="xiaohongshu"], .swiper-slide img, .note-slider img',
    ),
  );
  if (images.length === 0) return packed;
  promoteMedia(doc.body, url);
  const extras = images
    .map((img) => img.getAttribute('src'))
    .filter((src): src is string => typeof src === 'string' && src.startsWith('http'))
    .map((src) => `<p><img src="${src}"></p>`)
    .join('');
  if (extras === '') return packed;
  return { ...packed, html: `${packed.html}${extras}` };
}

function twitter(doc: Document, url: string): SiteExtract | null {
  const tweet = doc.querySelector('article[data-testid="tweet"]');
  if (tweet === null) {
    const title = og(doc, 'og:title') || og(doc, 'twitter:title') || '';
    return pack(title, doc.querySelector('article'), { siteName: 'X' }, url);
  }
  promoteMedia(tweet, url);
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

export const SITE_EXTRACTORS: readonly SiteExtractor[] = [
  {
    name: 'wechat',
    match: (host) => host === 'mp.weixin.qq.com',
    extract: wechat,
  },
  {
    name: 'zhihu',
    match: (host) => host === 'zhihu.com' || host.endsWith('.zhihu.com'),
    extract: zhihu,
  },
  {
    name: 'xhs',
    match: (host) => host.endsWith('xiaohongshu.com') || host.endsWith('xhslink.com'),
    extract: xhs,
  },
  {
    name: 'twitter',
    match: (host) =>
      host === 'x.com' ||
      host === 'twitter.com' ||
      host.endsWith('.x.com') ||
      host.endsWith('.twitter.com'),
    extract: twitter,
  },
];

export function extractSite(doc: Document, url: string): SiteExtract | null {
  const host = hostOf(url);
  for (const extractor of SITE_EXTRACTORS) {
    if (extractor.match(host, url)) return extractor.extract(doc, url);
  }
  return null;
}
