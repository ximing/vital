import { parseMarkdownToMdast, type MdastRoot } from '@vital/markdown';
import { imageSrcKeys, type InboxAsset } from '@vital/dto';
import { looksLikeMarkdown } from './html';
import { isElement, parseHtml, textContent, type HtmlNode } from './html-ast';

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
const UPLOAD_RE =
  /\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

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

export function isFileAsset(asset: InboxAsset): boolean {
  return (
    asset.mime === 'application/pdf' ||
    asset.mime.startsWith('video/') ||
    asset.mime.startsWith('audio/')
  );
}

export function prepareArticleNodes(
  html: string | null,
  text: string | null,
  assets: InboxAsset[],
): HtmlNode[] {
  const source = readerSource(html, text);
  if (source === '') return [];
  const rewritten = rewriteAssets(tidyArticle(parseHtml(source)), assets);
  return rewritten.filter((node) => !isBlankTextNode(node));
}

export function readerSource(html: string | null, text: string | null): string {
  const htmlTrim = html?.trim() ?? '';
  const textTrim = text?.trim() ?? '';
  const markdown = textTrim !== '' && looksLikeMarkdown(textTrim);
  if (htmlTrim !== '') {
    if (markdown && isMarkdownWrapperHtml(htmlTrim)) return markdownToHtml(textTrim);
    return htmlTrim;
  }
  if (markdown) return markdownToHtml(textTrim);
  if (textTrim !== '') return textToHtml(textTrim);
  return '';
}

/** True when HTML is only a wrapping <p> (plus <br>) around text — escapeParagraph of markdown. */
export function isMarkdownWrapperHtml(html: string): boolean {
  const trimmed = html.trim();
  const wrapped = /^<p\b[^>]*>([\s\S]*)<\/p>$/i.exec(trimmed);
  const inner = wrapped?.[1] ?? trimmed;
  return !/<[a-z]/i.test(inner.replace(/<br\s*\/?>/gi, ''));
}

function textToHtml(text: string): string {
  return escapeXml(text)
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function markdownToHtml(md: string): string {
  return parseMarkdownToMdast(md)
    .children.map((node) => flowToHtml(node))
    .join('');
}

function flowToHtml(node: MdastRoot['children'][number] | { type: string }): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${phrasingToHtml(asPhrasing(node))}</p>`;
    case 'heading': {
      const depth = 'depth' in node && typeof node.depth === 'number' ? node.depth : 1;
      const level = Math.min(6, Math.max(1, depth));
      return `<h${level}>${phrasingToHtml(asPhrasing(node))}</h${level}>`;
    }
    case 'list': {
      const ordered = 'ordered' in node && node.ordered === true;
      const tag = ordered ? 'ol' : 'ul';
      const start =
        ordered && 'start' in node && typeof node.start === 'number' && node.start !== 1
          ? ` start="${node.start}"`
          : '';
      const items = childrenOf(node)
        .map((item) => `<li>${childrenOf(item).map((child) => flowToHtml(child)).join('')}</li>`)
        .join('');
      return `<${tag}${start}>${items}</${tag}>`;
    }
    case 'code': {
      const value = 'value' in node && typeof node.value === 'string' ? node.value : '';
      return `<pre><code>${escapeXml(value)}</code></pre>`;
    }
    case 'blockquote':
      return `<blockquote>${childrenOf(node).map((child) => flowToHtml(child)).join('')}</blockquote>`;
    case 'thematicBreak':
      return '<hr>';
    case 'table':
      return `<table>${childrenOf(node)
        .map(
          (row) =>
            `<tr>${childrenOf(row)
              .map((cell) => `<td>${phrasingToHtml(asPhrasing(cell))}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</table>`;
    case 'vitalEntity': {
      const kind = 'kind' in node && typeof node.kind === 'string' ? node.kind : '';
      const id = 'id' in node && typeof node.id === 'string' ? node.id : '';
      return `<p>[[${escapeXml(kind)}:${escapeXml(id)}]]</p>`;
    }
    default:
      return childrenOf(node).map((child) => flowToHtml(child)).join('');
  }
}

function phrasingToHtml(nodes: Array<{ type: string }>): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return escapeXml('value' in node && typeof node.value === 'string' ? node.value : '');
        case 'strong':
          return `<strong>${phrasingToHtml(childrenOf(node))}</strong>`;
        case 'emphasis':
          return `<em>${phrasingToHtml(childrenOf(node))}</em>`;
        case 'delete':
          return `<del>${phrasingToHtml(childrenOf(node))}</del>`;
        case 'inlineCode':
          return `<code>${escapeXml('value' in node && typeof node.value === 'string' ? node.value : '')}</code>`;
        case 'link': {
          const url = 'url' in node && typeof node.url === 'string' ? node.url : '';
          return `<a href="${escapeXml(url)}">${phrasingToHtml(childrenOf(node))}</a>`;
        }
        case 'break':
          return '<br>';
        case 'image': {
          const url = 'url' in node && typeof node.url === 'string' ? node.url : '';
          const alt = 'alt' in node && typeof node.alt === 'string' ? node.alt : '';
          return `<img src="${escapeXml(url)}" alt="${escapeXml(alt)}">`;
        }
        case 'vitalEntity': {
          const kind = 'kind' in node && typeof node.kind === 'string' ? node.kind : '';
          const id = 'id' in node && typeof node.id === 'string' ? node.id : '';
          return `[[${escapeXml(kind)}:${escapeXml(id)}]]`;
        }
        default:
          return phrasingToHtml(childrenOf(node));
      }
    })
    .join('');
}

function childrenOf(node: { type: string }): Array<{ type: string }> {
  if (!('children' in node) || !Array.isArray(node.children)) return [];
  return node.children.filter((child): child is { type: string } => {
    return typeof child === 'object' && child !== null && 'type' in child;
  });
}

function asPhrasing(node: { type: string }): Array<{ type: string }> {
  return childrenOf(node);
}

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
  return out.filter((node) => !isVisuallyEmpty(node) || keepsEmpty(node));
}

function keepsEmpty(node: HtmlNode): boolean {
  return isElement(node) && KEEP_EMPTY_TAGS.has(node.tag);
}

function rewriteAssets(nodes: HtmlNode[], assets: InboxAsset[]): HtmlNode[] {
  const bySrc = new Map<string, InboxAsset>();
  for (const asset of assets) {
    for (const key of imageSrcKeys(asset.originalSrc)) {
      if (!bySrc.has(key)) bySrc.set(key, asset);
    }
  }
  const resolve = (src: string): string | null => {
    for (const key of imageSrcKeys(src)) {
      const hit = bySrc.get(key);
      if (hit?.url) return hit.url;
    }
    const match = UPLOAD_RE.exec(src);
    const attachmentId = match?.[1] ?? null;
    if (attachmentId !== null) {
      return assets.find((candidate) => candidate.attachmentId === attachmentId)?.url ?? null;
    }
    return absolutizeHttpUrl(src);
  };

  const walk = (list: HtmlNode[]): HtmlNode[] => {
    const out: HtmlNode[] = [];
    for (const node of list) {
      if (node.type === 'text') {
        out.push(node);
        continue;
      }
      const attrs = { ...node.attrs };
      if (node.tag === 'img' || node.tag === 'source') {
        const src = attrs.src ?? '';
        const url = resolve(src);
        if (url === null) continue;
        attrs.src = url;
      }
      if (node.tag === 'video') {
        if (attrs.src) {
          const url = resolve(attrs.src);
          if (url === null) delete attrs.src;
          else attrs.src = url;
        }
        if (attrs.poster) {
          const url = resolve(attrs.poster);
          if (url === null) delete attrs.poster;
          else attrs.poster = url;
        }
      }
      if (node.tag === 'a' && attrs.href && !isSafeHref(attrs.href)) delete attrs.href;
      out.push({ ...node, attrs, children: walk(node.children) });
    }
    return out;
  };
  return walk(nodes);
}

export function isSafeHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src.trim());
}

function absolutizeHttpUrl(src: string): string | null {
  const trimmed = src.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\/[^/]/.test(trimmed)) return `https:${trimmed}`;
  return null;
}

export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  return /^(https?:|mailto:)/i.test(trimmed);
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
  if (node.children.some((child) => isElement(child) && MEDIA_TAGS.has(child.tag))) return false;
  return isBlankText(textContent(node.children));
}

function durationCaption(text: string): string | null {
  const match =
    text.match(/时长\s*(\d{1,2}:\d{2}(?::\d{2})?)/) ?? text.match(/\d{1,2}:\d{2}\/(\d{1,2}:\d{2})/);
  return match?.[1] !== undefined ? `视频 · ${match[1]}` : null;
}

function isChromeOnlyText(text: string): boolean {
  let s = text.replace(/\s+/g, '');
  if (s === '') return false;
  s = s.replace(/百分之\d+/g, '');
  s = s.replace(/时长\d{1,2}:\d{2}(?::\d{2})?/g, '');
  s = s.replace(/\d{1,2}:\d{2}(?:\/\d{1,2}:\d{2})?/g, '');
  s = s.replace(/[,，、.|:：%\-_/]/g, '');
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
