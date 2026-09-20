import { isSafeHref, safeMediaSrc } from './refs.js';
import {
  EMPTY_ARTICLE_DOC,
  type ArticleBlockNode,
  type ArticleDoc,
  type ArticleImageNode,
  type ArticleInlineNode,
  type ArticleListItemNode,
  type ArticleMark,
  type ArticleTableRowNode,
  type ArticleVideoNode,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNodes(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function markOf(raw: unknown): ArticleMark | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  if (
    raw.type === 'bold' ||
    raw.type === 'italic' ||
    raw.type === 'underline' ||
    raw.type === 'strike' ||
    raw.type === 'code' ||
    raw.type === 'subscript' ||
    raw.type === 'superscript' ||
    raw.type === 'highlight'
  ) {
    return { type: raw.type };
  }
  if (raw.type === 'link' && isRecord(raw.attrs) && typeof raw.attrs.href === 'string') {
    const href = raw.attrs.href.trim();
    if (!isSafeHref(href)) return null;
    const title = raw.attrs.title;
    return typeof title === 'string' && title !== ''
      ? { type: 'link', attrs: { href, title } }
      : { type: 'link', attrs: { href } };
  }
  return null;
}

function imageBlock(node: Record<string, unknown>): ArticleBlockNode | null {
  const attrs = isRecord(node.attrs) ? node.attrs : {};
  if (typeof attrs.src !== 'string') return null;
  const src = safeMediaSrc(attrs.src);
  if (src === null) return null;
  const image: ArticleImageNode = { type: 'image', attrs: { src } };
  if (typeof attrs.alt === 'string' && attrs.alt !== '') image.attrs.alt = attrs.alt;
  if (typeof attrs.width === 'number' && Number.isInteger(attrs.width) && attrs.width > 0) {
    image.attrs.width = attrs.width;
  }
  if (typeof attrs.height === 'number' && Number.isInteger(attrs.height) && attrs.height > 0) {
    image.attrs.height = attrs.height;
  }
  return image;
}

function videoBlock(node: Record<string, unknown>): ArticleBlockNode | null {
  const attrs = isRecord(node.attrs) ? node.attrs : {};
  if (typeof attrs.src !== 'string') return null;
  const src = safeMediaSrc(attrs.src);
  if (src === null) return null;
  const video: ArticleVideoNode = { type: 'video', attrs: { src } };
  if (typeof attrs.poster === 'string') {
    const poster = safeMediaSrc(attrs.poster);
    if (poster !== null) video.attrs.poster = poster;
  }
  if (typeof attrs.mime === 'string' && attrs.mime !== '') video.attrs.mime = attrs.mime;
  return video;
}

function entityText(node: Record<string, unknown>): ArticleInlineNode | null {
  const attrs = isRecord(node.attrs) ? node.attrs : {};
  const kind = attrs.kind;
  const id = attrs.id;
  if ((kind === 'task' || kind === 'inbox') && typeof id === 'string' && id !== '') {
    return { type: 'text', text: `[[${kind}:${id}]]` };
  }
  return null;
}

function inlineAndMedia(nodes: Record<string, unknown>[]): {
  inline: ArticleInlineNode[];
  media: ArticleBlockNode[];
} {
  const inline: ArticleInlineNode[] = [];
  const media: ArticleBlockNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text' && typeof node.text === 'string' && node.text !== '') {
      const marks = Array.isArray(node.marks)
        ? node.marks.map(markOf).filter((mark): mark is ArticleMark => mark !== null)
        : [];
      inline.push(marks.length > 0 ? { type: 'text', text: node.text, marks } : { type: 'text', text: node.text });
      continue;
    }
    if (node.type === 'hardBreak') {
      inline.push({ type: 'hardBreak' });
      continue;
    }
    if (node.type === 'image') {
      const image = imageBlock(node);
      if (image) media.push(image);
      continue;
    }
    if (node.type === 'video') {
      const video = videoBlock(node);
      if (video) media.push(video);
      continue;
    }
    if (node.type === 'vitalEntity') {
      const text = entityText(node);
      if (text) inline.push(text);
    }
  }
  return { inline, media };
}

function paragraphBlocks(nodes: Record<string, unknown>[]): ArticleBlockNode[] {
  const { inline, media } = inlineAndMedia(nodes);
  const out: ArticleBlockNode[] = [];
  if (inline.length > 0 && !inline.every((node) => node.type === 'text' && node.text.trim() === '')) {
    out.push({ type: 'paragraph', content: inline });
  }
  out.push(...media);
  return out;
}

function listItem(node: Record<string, unknown>): ArticleListItemNode {
  return { type: 'listItem', content: asNodes(node.content).flatMap(blockFromPm) };
}

function tableRow(node: Record<string, unknown>): ArticleTableRowNode {
  return {
    type: 'tableRow',
    content: asNodes(node.content).map((cell) => ({
      type: cell.type === 'tableHeader' ? ('tableHeader' as const) : ('tableCell' as const),
      content: asNodes(cell.content).flatMap(blockFromPm),
    })),
  };
}

function blockFromPm(node: Record<string, unknown>): ArticleBlockNode[] {
  switch (node.type) {
    case 'paragraph':
      return paragraphBlocks(asNodes(node.content));
    case 'heading': {
      const raw = isRecord(node.attrs) ? node.attrs.level : undefined;
      const level = raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5 || raw === 6 ? raw : 1;
      const { inline, media } = inlineAndMedia(asNodes(node.content));
      const heading: ArticleBlockNode[] =
        inline.length > 0 ? [{ type: 'heading', attrs: { level }, content: inline }] : [];
      return [...heading, ...media];
    }
    case 'blockquote':
      return [{ type: 'blockquote', content: asNodes(node.content).flatMap(blockFromPm) }];
    case 'codeBlock': {
      const text = asNodes(node.content)
        .map((child) => (typeof child.text === 'string' ? child.text : ''))
        .join('');
      if (text === '') return [];
      const language = isRecord(node.attrs) && typeof node.attrs.language === 'string' ? node.attrs.language : undefined;
      return language !== undefined && language !== ''
        ? [{ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text }] }]
        : [{ type: 'codeBlock', content: [{ type: 'text', text }] }];
    }
    case 'bulletList':
      return [{ type: 'bulletList', content: asNodes(node.content).map(listItem) }];
    case 'orderedList': {
      const start = isRecord(node.attrs) ? node.attrs.start : undefined;
      const items = asNodes(node.content).map(listItem);
      return typeof start === 'number' && Number.isInteger(start) && start > 1
        ? [{ type: 'orderedList', attrs: { start }, content: items }]
        : [{ type: 'orderedList', content: items }];
    }
    case 'horizontalRule':
      return [{ type: 'horizontalRule' }];
    case 'table':
      return [{ type: 'table', content: asNodes(node.content).map(tableRow) }];
    case 'image': {
      const image = imageBlock(node);
      return image ? [image] : [];
    }
    case 'video': {
      const video = videoBlock(node);
      return video ? [video] : [];
    }
    default:
      return asNodes(node.content).flatMap(blockFromPm);
  }
}

/** Coerce TipTap/ProseMirror JSON (e.g. markdown pmjson) into an article-doc. */
export function pmJsonToArticleDoc(raw: unknown): ArticleDoc {
  if (!isRecord(raw) || raw.type !== 'doc') return EMPTY_ARTICLE_DOC;
  return { type: 'doc', content: asNodes(raw.content).flatMap(blockFromPm) };
}
