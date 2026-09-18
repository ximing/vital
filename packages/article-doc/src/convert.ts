import { isElement, parseHtml, textContent, type HtmlNode } from './html-ast.js';
import { isSafeHref, safeMediaSrc } from './refs.js';
import { tidyArticle } from './tidy.js';
import type {
  ArticleBlockNode,
  ArticleDoc,
  ArticleInlineNode,
  ArticleListItemNode,
  ArticleMark,
  ArticleTableRowNode,
} from './types.js';

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Capture HTML → article doc. Media srcs stay as-is here; rebindDocMedia binds attachments. */
export function htmlToArticleDoc(html: string): ArticleDoc {
  const tidied = tidyArticle(parseHtml(html));
  return { type: 'doc', content: blocksFromNodes(tidied) };
}

function blocksFromNodes(nodes: HtmlNode[]): ArticleBlockNode[] {
  const out: ArticleBlockNode[] = [];
  let inline: ArticleInlineNode[] = [];
  const flush = (): void => {
    const content = mergeInline(inline);
    inline = [];
    if (content.length === 0 || content.every((node) => node.type === 'text' && node.text.trim() === '')) {
      return;
    }
    out.push({ type: 'paragraph', content });
  };
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value !== '') inline.push({ type: 'text', text: node.value });
      continue;
    }
    const blocks = blockFromElement(node);
    if (blocks === null) {
      // Inline element at block level: fold into the current paragraph run.
      inline.push(...inlineFromNodes([node], []));
      continue;
    }
    flush();
    out.push(...blocks);
  }
  flush();
  return out;
}

/** Block-producing elements; returns null for inline elements. */
function blockFromElement(
  node: Extract<HtmlNode, { type: 'element' }>,
): ArticleBlockNode[] | null {
  const tag = node.tag;
  if (tag === 'p') return blocksFromInlineContainer(node.children);
  if (HEADING_TAGS.has(tag)) {
    const content = mergeInline(inlineFromNodes(node.children, []));
    if (content.length === 0) return [];
    return [{ type: 'heading', attrs: { level: Number(tag[1]) }, content }];
  }
  if (tag === 'blockquote') return [{ type: 'blockquote', content: blocksFromNodes(node.children) }];
  if (tag === 'pre') {
    const text = textContent(node.children).replace(/\n+$/, '');
    return text === '' ? [] : [{ type: 'codeBlock', content: [{ type: 'text', text }] }];
  }
  if (tag === 'ul' || tag === 'ol') return [listFromElement(node)];
  if (tag === 'hr') return [{ type: 'horizontalRule' }];
  if (tag === 'img') {
    const image = imageFromElement(node);
    return image === null ? [] : [image];
  }
  if (tag === 'video') {
    const video = videoFromElement(node);
    return video === null ? [] : [video];
  }
  if (tag === 'figure') return blocksFromNodes(node.children);
  if (tag === 'figcaption') return blocksFromInlineContainer(node.children);
  if (tag === 'table') return tableFromElement(node);
  if (tag === 'caption' || tag === 'summary' || tag === 'dt' || tag === 'dd') {
    return blocksFromInlineContainer(node.children);
  }
  if (tag === 'details' || tag === 'dl') return blocksFromNodes(node.children);
  // thead/tbody/tfoot/tr/td/th without a table parent, li without a list: degrade gracefully.
  if (tag === 'li') return blocksFromInlineContainer(node.children);
  return null;
}

/**
 * Paragraph-like container → blocks. Media elements nested anywhere inside
 * (e.g. `<p>text <a><img></a> more</p>`) are lifted out as sibling blocks so
 * no image/video is lost to inline flattening.
 */
function blocksFromInlineContainer(nodes: HtmlNode[]): ArticleBlockNode[] {
  const out: ArticleBlockNode[] = [];
  let inline: ArticleInlineNode[] = [];
  const flush = (): void => {
    const content = mergeInline(inline);
    inline = [];
    if (content.length === 0 || content.every((node) => node.type === 'text' && node.text.trim() === '')) {
      return;
    }
    out.push({ type: 'paragraph', content });
  };
  const lift = (list: HtmlNode[]): void => {
    for (const child of list) {
      if (child.type === 'text') {
        if (child.value !== '') inline.push({ type: 'text', text: child.value });
        continue;
      }
      if (child.tag === 'img') {
        flush();
        const image = imageFromElement(child);
        if (image !== null) out.push(image);
        continue;
      }
      if (child.tag === 'video') {
        flush();
        const video = videoFromElement(child);
        if (video !== null) out.push(video);
        continue;
      }
      if (containsMedia(child)) {
        lift(child.children);
        continue;
      }
      inline.push(...inlineFromNodes([child], []));
    }
  };
  lift(nodes);
  flush();
  return out;
}

function containsMedia(node: Extract<HtmlNode, { type: 'element' }>): boolean {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.tag === 'img' || child.tag === 'video') return true;
    if (containsMedia(child)) return true;
  }
  return false;
}

function listFromElement(
  node: Extract<HtmlNode, { type: 'element' }>,
): ArticleBlockNode {
  const items: ArticleListItemNode[] = [];
  for (const child of node.children) {
    if (!isElement(child) || child.tag !== 'li') continue;
    items.push({ type: 'listItem', content: blocksFromNodes(child.children) });
  }
  if (node.tag === 'ol') {
    const start = Number(node.attrs.start);
    const attrs = Number.isInteger(start) && start > 1 ? { start } : undefined;
    return attrs === undefined
      ? { type: 'orderedList', content: items }
      : { type: 'orderedList', attrs, content: items };
  }
  return { type: 'bulletList', content: items };
}

function tableFromElement(node: Extract<HtmlNode, { type: 'element' }>): ArticleBlockNode[] {
  const out: ArticleBlockNode[] = [];
  const rows: ArticleTableRowNode[] = [];
  const walkRows = (el: Extract<HtmlNode, { type: 'element' }>, inHead: boolean): void => {
    for (const child of el.children) {
      if (!isElement(child)) continue;
      if (child.tag === 'caption') {
        const content = inlineFromNodes(child.children, []);
        if (content.length > 0) out.push({ type: 'paragraph', content });
        continue;
      }
      if (child.tag === 'thead') {
        walkRows(child, true);
        continue;
      }
      if (child.tag === 'tbody' || child.tag === 'tfoot') {
        walkRows(child, inHead);
        continue;
      }
      if (child.tag !== 'tr') continue;
      const cells: ArticleTableRowNode['content'] = [];
      for (const cell of child.children) {
        if (!isElement(cell) || (cell.tag !== 'th' && cell.tag !== 'td')) continue;
        const type = cell.tag === 'th' || inHead ? 'tableHeader' : 'tableCell';
        cells.push({ type, content: blocksFromNodes(cell.children) });
      }
      if (cells.length > 0) rows.push({ type: 'tableRow', content: cells });
    }
  };
  walkRows(node, false);
  if (rows.length > 0) out.push({ type: 'table', content: rows });
  return out;
}

function imageFromElement(
  node: Extract<HtmlNode, { type: 'element' }>,
): ArticleBlockNode | null {
  const src = safeMediaSrc(node.attrs.src ?? '');
  if (src === null) return null;
  const attrs: Extract<ArticleBlockNode, { type: 'image' }>['attrs'] = { src };
  const alt = node.attrs.alt?.trim();
  if (alt) attrs.alt = alt.slice(0, 500);
  const width = Number(node.attrs.width);
  const height = Number(node.attrs.height);
  if (Number.isFinite(width) && width > 0) attrs.width = Math.floor(width);
  if (Number.isFinite(height) && height > 0) attrs.height = Math.floor(height);
  return { type: 'image', attrs };
}

function videoFromElement(
  node: Extract<HtmlNode, { type: 'element' }>,
): ArticleBlockNode | null {
  const source = findDescendant(node, 'source');
  const src = safeMediaSrc(node.attrs.src ?? source?.attrs.src ?? '');
  if (src === null) return null;
  const attrs: Extract<ArticleBlockNode, { type: 'video' }>['attrs'] = { src };
  const poster = node.attrs.poster ? safeMediaSrc(node.attrs.poster) : null;
  if (poster !== null) attrs.poster = poster;
  const mime = node.attrs.type ?? source?.attrs.type;
  if (mime !== undefined && /^[^\s"'{}]{1,127}$/.test(mime)) attrs.mime = mime;
  return { type: 'video', attrs };
}

function findDescendant(
  node: Extract<HtmlNode, { type: 'element' }>,
  tag: string,
): Extract<HtmlNode, { type: 'element' }> | null {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.tag === tag) return child;
    const found = findDescendant(child, tag);
    if (found !== null) return found;
  }
  return null;
}

const MARK_TAGS: Record<string, ArticleMark['type']> = {  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  ins: 'underline',
  s: 'strike',
  del: 'strike',
  strike: 'strike',
  code: 'code',
  kbd: 'code',
  sub: 'subscript',
  sup: 'superscript',
  mark: 'highlight',
};

/** Fold adjacent text nodes with identical marks into one. */
function mergeInline(nodes: ArticleInlineNode[]): ArticleInlineNode[] {
  const out: ArticleInlineNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (
      node.type === 'text' &&
      prev !== undefined &&
      prev.type === 'text' &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      out[out.length - 1] = { ...prev, text: prev.text + node.text };
      continue;
    }
    out.push(node);
  }
  return out;
}

function inlineFromNodes(nodes: HtmlNode[], marks: ArticleMark[]): ArticleInlineNode[] {  const out: ArticleInlineNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value === '') continue;
      out.push(
        marks.length === 0
          ? { type: 'text', text: node.value }
          : { type: 'text', text: node.value, marks: [...marks] },
      );
      continue;
    }
    if (node.tag === 'br') {
      out.push({ type: 'hardBreak' });
      continue;
    }
    if (node.tag === 'a') {
      const href = node.attrs.href ?? '';
      if (isSafeHref(href)) {
        const link: ArticleMark = { type: 'link', attrs: { href: href.trim() } };
        const title = node.attrs.title?.trim();
        if (title) link.attrs.title = title.slice(0, 500);
        out.push(...inlineFromNodes(node.children, [...marks, link]));
      } else {
        out.push(...inlineFromNodes(node.children, marks));
      }
      continue;
    }
    const mark = MARK_TAGS[node.tag];
    if (mark !== undefined) {
      out.push(...inlineFromNodes(node.children, [...marks, { type: mark } as ArticleMark]));
      continue;
    }
    // Inline images stay meaningful inside paragraphs is not supported — drop into block flow
    // is impossible here, so media/unknown inline elements flatten to their text content.
    out.push(...inlineFromNodes(node.children, marks));
  }
  return out;
}
