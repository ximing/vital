const WRAPPER_TAGS = new Set(['SPAN', 'SECTION', 'DIV', 'FONT']);
const EMPTY_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'SECTION',
  'DIV',
  'SPAN',
  'BLOCKQUOTE',
  'LI',
  'FIGCAPTION',
]);
const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'FIGURE',
  'HR',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'CAPTION',
  'COLGROUP',
  'COL',
  'DL',
  'DT',
  'DD',
  'DETAILS',
  'SUMMARY',
  'PICTURE',
  'PRE',
  'IMG',
]);

function isBlankText(value: string): boolean {
  return value.replace(/[\s\u00a0\u200b\ufeff]+/g, '') === '';
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (parent === null) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

function isVisuallyEmpty(el: Element): boolean {
  if (el.querySelector('img, picture, video, iframe, svg, figure, hr, table') !== null)
    return false;
  return isBlankText(el.textContent);
}

const CHROME_TOKENS = [
  '已关注',
  '关注',
  '重播',
  '分享',
  '赞',
  '关闭',
  '观看更多',
  '更多',
  '退出全屏',
  '切换到竖屏全屏',
  '切换到横屏模式',
  '继续播放',
  '继续观看',
  '进度条',
  '播放',
  '倍速',
  '全屏',
  '倍速播放中',
  '0.5倍',
  '0.75倍',
  '1.0倍',
  '1.5倍',
  '2.0倍',
  '高清',
  '流畅',
  '您的浏览器不支持video标签',
  '写下你的评论',
  '已同步到看一看',
  '点赞',
  '在看',
  '视频详情',
  '原创',
  '分享视频',
  '0/0',
];

function durationCaption(text: string): string | null {
  const match =
    text.match(/时长\s*(\d{1,2}:\d{2}(?::\d{2})?)/) ?? text.match(/\d{1,2}:\d{2}\/(\d{1,2}:\d{2})/);
  return match?.[1] !== undefined ? `视频 · ${match[1]}` : null;
}

function withoutChromeGlue(value: string): string {
  return value.replace(/[,，、.|:：%\-_/]/g, '');
}

function isChromeOnlyText(text: string): boolean {
  let s = text.replace(/\s+/g, '');
  if (s === '') return false;
  // `<code>cwd</code>、<code>settingsManager</code>` and `src`/`tidy.ts` put the separator in its own text node.
  if (withoutChromeGlue(s) === '') return false;
  s = s.replace(/百分之\d+/g, '');
  s = s.replace(/时长\d{1,2}:\d{2}(?::\d{2})?/g, '');
  s = s.replace(/\d{1,2}:\d{2}(?:\/\d{1,2}:\d{2})?/g, '');
  s = withoutChromeGlue(s);
  let prev = '';
  while (s !== prev) {
    prev = s;
    for (const tok of CHROME_TOKENS) s = s.split(tok).join('');
  }
  return s.length === 0;
}

function scrubChromeText(text: string): string {
  let s = text;
  s = s.replace(
    /[\u4e00-\u9fff]{0,20}已关注分享视频，时长(\d{1,2}:\d{2}(?::\d{2})?)/g,
    '\n视频 · $1\n',
  );
  s = s.replace(/分享视频，时长(\d{1,2}:\d{2}(?::\d{2})?)/g, '\n视频 · $1\n');
  s = s.replace(/您的浏览器不支持\s*video\s*标签/g, '');
  s = s.replace(/继续播放进度条，百分之\d+/g, '');
  s = s.replace(
    /切换到竖屏全屏|切换到横屏模式|退出全屏|倍速播放中|已同步到看一看|写下你的评论|视频详情|观看更多/g,
    '',
  );
  s = s.replace(/0\.5倍|0\.75倍|1\.0倍|1\.5倍|2\.0倍/g, '');
  s = s.replace(/00:00\/\d{1,2}:\d{2}/g, '');
  s = s.replace(/0\/0/g, '');
  s = s.replace(/已关注/g, '');
  s = s.replace(/分享视频/g, '');
  s = s.replace(/分享点赞在看|点赞在看/g, '');
  s = s.replace(/原创[,，]/g, '');
  s = s
    .split(/(视频 · \d{1,2}:\d{2}(?::\d{2})?)/)
    .map((part) => (part.startsWith('视频 ·') || !isChromeOnlyText(part) ? part : ''))
    .join('');
  return s.replace(/[ \t]{2,}/g, ' ');
}

function stripWeChatPlayerChrome(root: Element): void {
  for (const img of [...root.querySelectorAll('img')]) {
    const src = img.getAttribute('src')?.trim() ?? '';
    if (src === '' || src.startsWith('data:')) img.remove();
  }
  for (const el of [...root.querySelectorAll('i, ul')]) {
    if (isVisuallyEmpty(el)) el.remove();
  }
  for (let pass = 0; pass < 6; pass += 1) {
    let removed = false;
    for (const el of [
      ...root.querySelectorAll('a, i, strong, p, span, li, em, b, font, ul'),
    ].reverse()) {
      if (el.closest('pre, code, figure, table') !== null) continue;
      const text = el.textContent;
      if (!isChromeOnlyText(text)) continue;
      const cap = durationCaption(text);
      if (cap !== null) {
        const p = el.ownerDocument.createElement('p');
        p.textContent = cap;
        el.replaceWith(p);
      } else {
        el.remove();
      }
      removed = true;
    }
    if (!removed) break;
  }
  const texts: Text[] = [];
  const walk = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) texts.push(walk.currentNode as Text);
  for (const node of texts) {
    if (node.parentElement?.closest('pre, code, figure, table') != null) continue;
    const raw = node.textContent;
    if (isChromeOnlyText(raw)) {
      node.textContent = durationCaption(raw) ?? '';
    } else {
      node.textContent = scrubChromeText(raw);
    }
  }
  let prevCap = '';
  for (const node of texts) {
    const t = node.textContent.trim();
    if (/^视频 · \d/.test(t) && t === prevCap) node.textContent = '';
    if (t !== '') prevCap = t;
  }
}

function skipBlank(node: ChildNode | null, dir: 'prev' | 'next'): ChildNode | null {
  let cur = node;
  while (cur && cur.nodeType === Node.TEXT_NODE && isBlankText(cur.textContent ?? '')) {
    cur = dir === 'prev' ? cur.previousSibling : cur.nextSibling;
  }
  return cur;
}

function isBlockish(node: ChildNode | null): boolean {
  if (node === null) return true;
  if (node.nodeType === Node.TEXT_NODE) return isBlankText(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return BLOCK_TAGS.has((node as Element).tagName);
}

/** Drop WeChat-style nested empty sections/spans and consecutive blank lines. */
export function tidyArticleHtml(html: string): string {
  if (html.trim() === '') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body;
  for (const el of [...root.querySelectorAll('span, section, div, font')].reverse()) {
    if (!WRAPPER_TAGS.has(el.tagName)) continue;
    if (el.closest('pre, code, figure, table') !== null) continue;
    unwrap(el);
  }
  stripWeChatPlayerChrome(root);
  const emptyCandidates = root.querySelectorAll(
    'p, h1, h2, h3, h4, h5, h6, section, div, span, blockquote, li, figcaption',
  );
  for (const el of [...emptyCandidates]) {
    if (!EMPTY_TAGS.has(el.tagName)) continue;
    if (el.closest('pre, code, table') !== null) continue;
    if (isVisuallyEmpty(el)) el.remove();
  }
  for (const br of [...root.querySelectorAll('br')]) {
    const prev = skipBlank(br.previousSibling, 'prev');
    const next = skipBlank(br.nextSibling, 'next');
    if (prev !== null && prev.nodeName === 'BR') {
      br.remove();
      continue;
    }
    if (isBlockish(prev) || isBlockish(next)) br.remove();
  }
  for (const p of [...root.querySelectorAll('p')]) {
    const kids = [...p.childNodes].filter(
      (node) => !(node.nodeType === Node.TEXT_NODE && isBlankText(node.textContent ?? '')),
    );
    if (kids.length === 1 && kids[0]?.nodeName === 'IMG') unwrap(p);
  }
  return root.innerHTML;
}
