import { isElement, textContent, type HtmlNode } from './html-ast.js';

const UNWRAP_TAGS = new Set([
  'span',
  'section',
  'div',
  'font',
  'html',
  'body',
  'picture',
  'fragment',
]);
const DROP_TAGS = new Set(['head', 'meta', 'link', 'button', 'input', 'form', 'textarea']);
const EMPTY_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'li',
  'figcaption',
]);
const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'figure',
  'hr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
  'img',
  'video',
]);
const MEDIA_TAGS = new Set(['img', 'picture', 'video', 'figure', 'hr', 'table']);
const KEEP_EMPTY_TAGS = new Set(['br', 'hr', 'img', 'video', 'source']);

/** Keep in sync with packages/article-html WeChat chrome scrubbing. */
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

export function tidyArticle(nodes: HtmlNode[]): HtmlNode[] {
  return trimEdges(collapseBr(collapseWs(nodes.flatMap((node) => tidyNode(node, false)), false)));
}

function tidyNode(node: HtmlNode, inPre: boolean): HtmlNode[] {
  if (node.type === 'text') {
    if (inPre) return node.value === '' ? [] : [node];
    const scrubbed = scrubChromeText(node.value);
    if (isChromeOnlyText(scrubbed)) {
      const cap = durationCaption(scrubbed);
      return cap === null ? [] : [{ type: 'text', value: cap }];
    }
    return scrubbed === '' ? [] : [{ type: 'text', value: scrubbed }];
  }
  if (DROP_TAGS.has(node.tag)) return [];
  if (node.tag === 'img' && (node.attrs.src === undefined || node.attrs.src === '')) return [];
  const nextPre = inPre || node.tag === 'pre' || node.tag === 'code';
  const children = node.children.flatMap((child) => tidyNode(child, nextPre));
  if (UNWRAP_TAGS.has(node.tag)) return children;
  const next: HtmlNode = { ...node, children };
  if (node.tag === 'p' && isSoleImage(children)) return children;
  if (EMPTY_TAGS.has(node.tag) && isVisuallyEmpty(next)) return [];
  return [next];
}

function collapseWs(nodes: HtmlNode[], inPre: boolean): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const value = inPre ? node.value : node.value.replace(/\s+/g, ' ');
      if (value === '' || (!inPre && isBlankText(value) && (out.length === 0 || isBlockNode(out[out.length - 1])))) {
        continue;
      }
      out.push({ type: 'text', value });
      continue;
    }
    const nextPre = inPre || node.tag === 'pre' || node.tag === 'code';
    out.push({ ...node, children: collapseWs(node.children, nextPre) });
  }
  return out;
}

function collapseBr(nodes: HtmlNode[]): HtmlNode[] {
  const mapped = nodes.map((node) =>
    node.type === 'element' ? { ...node, children: collapseBr(node.children) } : node,
  );
  const out: HtmlNode[] = [];
  for (const node of mapped) {
    if (isBr(node)) {
      const prev = out[out.length - 1];
      if (prev === undefined || isBr(prev) || isBlockNode(prev) || isBlankTextNode(prev)) continue;
      out.push(node);
      continue;
    }
    if (isBlockNode(node)) {
      while (out.length > 0 && (isBr(out[out.length - 1]) || isBlankTextNode(out[out.length - 1]))) {
        out.pop();
      }
    }
    if (isBlankTextNode(node) && (out.length === 0 || isBlockNode(out[out.length - 1]))) {
      continue;
    }
    out.push(node);
  }
  while (out.length > 0 && isBr(out[out.length - 1])) out.pop();
  return out;
}

function trimEdges(nodes: HtmlNode[], inPre = false): HtmlNode[] {
  const mapped = nodes.map((node) => {
    if (node.type !== 'element') return node;
    const nextPre = inPre || node.tag === 'pre' || node.tag === 'code';
    return { ...node, children: trimEdges(node.children, nextPre) };
  });
  if (inPre) return mapped;
  const out = [...mapped];
  while (out[0]?.type === 'text') {
    const value = out[0].value.replace(/^\s+/, '');
    if (value === '') {
      out.shift();
      continue;
    }
    out[0] = { type: 'text', value };
    break;
  }
  while (out[out.length - 1]?.type === 'text') {
    const last = out[out.length - 1];
    if (last === undefined || last.type !== 'text') break;
    const value = last.value.replace(/\s+$/, '');
    if (value === '') {
      out.pop();
      continue;
    }
    out[out.length - 1] = { type: 'text', value };
    break;
  }
  return out.filter((node) => node.type === 'text' || !isVisuallyEmpty(node) || keepsEmpty(node));
}

function keepsEmpty(node: HtmlNode): boolean {
  return isElement(node) && KEEP_EMPTY_TAGS.has(node.tag);
}

function isBr(node: HtmlNode | undefined): boolean {
  return node !== undefined && isElement(node) && node.tag === 'br';
}

function isBlockNode(node: HtmlNode | undefined): boolean {
  return node !== undefined && isElement(node) && BLOCK_TAGS.has(node.tag);
}

function isBlankText(value: string): boolean {
  return value.replace(/[\s\u00a0\u200b\ufeff]+/g, '') === '';
}

function isBlankTextNode(node: HtmlNode | undefined): boolean {
  return node !== undefined && node.type === 'text' && isBlankText(node.value);
}

function isSoleImage(children: HtmlNode[]): boolean {
  const meaningful = children.filter((child) => !isBlankTextNode(child));
  const only = meaningful[0];
  return meaningful.length === 1 && only !== undefined && isElement(only) && only.tag === 'img';
}

function isVisuallyEmpty(node: HtmlNode): boolean {
  if (node.type === 'text') return isBlankText(node.value);
  if (MEDIA_TAGS.has(node.tag)) return false;
  if (hasMediaDescendant(node)) return false;
  return isBlankText(textContent(node.children));
}

/** Media at any depth counts — `<ul><li><img></li></ul>` and `<p><a><img></a></p>` are not empty. */
function hasMediaDescendant(node: Extract<HtmlNode, { type: 'element' }>): boolean {
  return node.children.some(
    (child) => isElement(child) && (MEDIA_TAGS.has(child.tag) || hasMediaDescendant(child)),
  );
}

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
