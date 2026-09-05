import type {
  BlockContent,
  Code,
  Heading,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Emphasis,
  Delete,
  InlineCode,
  Text,
} from 'mdast';
import { isRecord, type MdastRoot, type PmMark, type PmNode } from './types.js';

function withContent(type: string, content: PmNode[], attrs?: PmNode['attrs']): PmNode {
  const node: PmNode = { type };
  if (attrs !== undefined) node.attrs = attrs;
  if (content.length > 0) node.content = content;
  return node;
}

function textNode(value: string, marks: PmMark[]): PmNode {
  const node: PmNode = { type: 'text', text: value };
  if (marks.length > 0) node.marks = marks;
  return node;
}

function phrasingToPm(nodes: PhrasingContent[], marks: PmMark[]): PmNode[] {
  const out: PmNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push(textNode(node.value, marks));
        break;
      case 'strong':
        out.push(...phrasingToPm(node.children, [...marks, { type: 'bold' }]));
        break;
      case 'emphasis':
        out.push(...phrasingToPm(node.children, [...marks, { type: 'italic' }]));
        break;
      case 'delete':
        out.push(...phrasingToPm(node.children, [...marks, { type: 'strike' }]));
        break;
      case 'inlineCode':
        out.push(textNode(node.value, [...marks, { type: 'code' }]));
        break;
      case 'link': {
        const attrs: Record<string, string | number | boolean | null> = { href: node.url };
        if (node.title !== null && node.title !== undefined) attrs.title = node.title;
        out.push(...phrasingToPm(node.children, [...marks, { type: 'link', attrs }]));
        break;
      }
      case 'break':
        out.push({ type: 'hardBreak' });
        break;
      case 'vitalEntity':
        out.push({
          type: 'vitalEntity',
          attrs: { kind: node.kind, id: node.id },
        });
        break;
      case 'image':
        out.push(textNode(node.alt ?? node.url, marks));
        break;
      default:
        break;
    }
  }
  return out;
}

function listToPm(node: List): PmNode {
  const type = node.ordered === true ? 'orderedList' : 'bulletList';
  const attrs =
    node.ordered === true && node.start !== null && node.start !== undefined && node.start !== 1
      ? { start: node.start }
      : undefined;
  return withContent(
    type,
    node.children.map((item) => listItemToPm(item)),
    attrs,
  );
}

function listItemToPm(node: ListItem): PmNode {
  return withContent(
    'listItem',
    node.children.map((child) => flowToPm(child)),
  );
}

function flowToPm(node: BlockContent | RootContent): PmNode {
  switch (node.type) {
    case 'paragraph':
      return withContent('paragraph', phrasingToPm(node.children, []));
    case 'heading':
      return withContent('heading', phrasingToPm(node.children, []), { level: node.depth });
    case 'list':
      return listToPm(node);
    case 'code': {
      const attrs =
        node.lang !== null && node.lang !== undefined && node.lang !== ''
          ? { language: node.lang }
          : undefined;
      const content = node.value === '' ? [] : [textNode(node.value, [])];
      return withContent('codeBlock', content, attrs);
    }
    case 'blockquote':
      return withContent(
        'blockquote',
        node.children.map((child) => flowToPm(child)),
      );
    case 'thematicBreak':
      return { type: 'horizontalRule' };
    default:
      return withContent('paragraph', []);
  }
}

export function mdastToPmJSON(tree: MdastRoot): PmNode {
  const content: PmNode[] = [];
  for (const child of tree.children) {
    if (child.type === 'vitalEntity') {
      content.push(withContent('paragraph', phrasingToPm([child], [])));
      continue;
    }
    content.push(flowToPm(child));
  }
  return { type: 'doc', content };
}

function isPmNode(value: unknown): value is PmNode {
  return isRecord(value) && typeof value.type === 'string';
}

function asPmNodes(value: unknown): PmNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPmNode);
}

function markHref(mark: PmMark): string {
  if (mark.attrs && typeof mark.attrs.href === 'string') return mark.attrs.href;
  return '';
}

function markTitle(mark: PmMark): string | null {
  if (!mark.attrs) return null;
  const title = mark.attrs.title;
  return typeof title === 'string' ? title : null;
}

function wrapPhrasing(inner: PhrasingContent, marks: PmMark[]): PhrasingContent {
  let node = inner;
  // Innermost first so stringify emits `**_text_**` rather than mixed wrappers.
  const order = ['code', 'strike', 'italic', 'bold', 'link'];
  const sorted = [...marks].sort((a, b) => {
    const ia = order.indexOf(a.type);
    const ib = order.indexOf(b.type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  for (const mark of sorted) {
    if (mark.type === 'code' && node.type === 'text') {
      const code: InlineCode = { type: 'inlineCode', value: node.value };
      node = code;
      continue;
    }
    if (mark.type === 'bold') {
      const strong: Strong = { type: 'strong', children: [node] };
      node = strong;
      continue;
    }
    if (mark.type === 'italic') {
      const em: Emphasis = { type: 'emphasis', children: [node] };
      node = em;
      continue;
    }
    if (mark.type === 'strike') {
      const del: Delete = { type: 'delete', children: [node] };
      node = del;
      continue;
    }
    if (mark.type === 'link') {
      const link: Link = {
        type: 'link',
        url: markHref(mark),
        title: markTitle(mark),
        children: [node],
      };
      node = link;
    }
  }
  return node;
}

function pmPhrasing(nodes: PmNode[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const value = node.text ?? '';
      const marks = node.marks ?? [];
      const text: Text = { type: 'text', value };
      out.push(wrapPhrasing(text, marks));
      continue;
    }
    if (node.type === 'hardBreak') {
      out.push({ type: 'break' });
      continue;
    }
    if (node.type === 'vitalEntity') {
      const attrs = node.attrs ?? {};
      const kind = attrs.kind;
      const id = attrs.id;
      if ((kind === 'task' || kind === 'inbox') && typeof id === 'string') {
        out.push({ type: 'vitalEntity', kind, id });
      }
    }
  }
  return out;
}

function pmListItem(node: PmNode): ListItem {
  const children: BlockContent[] = [];
  for (const child of asPmNodes(node.content)) {
    const flow = pmFlow(child);
    if (flow) children.push(flow);
  }
  const item: ListItem = { type: 'listItem', spread: false, children };
  return item;
}

function pmFlow(node: PmNode): BlockContent | null {
  switch (node.type) {
    case 'paragraph': {
      const p: Paragraph = { type: 'paragraph', children: pmPhrasing(asPmNodes(node.content)) };
      return p;
    }
    case 'heading': {
      const raw = node.attrs?.level;
      const depth = raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5 || raw === 6 ? raw : 1;
      const h: Heading = {
        type: 'heading',
        depth,
        children: pmPhrasing(asPmNodes(node.content)),
      };
      return h;
    }
    case 'bulletList':
    case 'orderedList': {
      const list: List = {
        type: 'list',
        ordered: node.type === 'orderedList',
        spread: false,
        children: asPmNodes(node.content).map((item) => pmListItem(item)),
      };
      if (node.type === 'orderedList') {
        const start = node.attrs?.start;
        list.start = typeof start === 'number' ? start : 1;
      }
      return list;
    }
    case 'codeBlock': {
      const language = node.attrs?.language;
      const text = asPmNodes(node.content)
        .map((c) => c.text ?? '')
        .join('');
      const code: Code = {
        type: 'code',
        lang: typeof language === 'string' ? language : null,
        value: text,
      };
      return code;
    }
    case 'blockquote':
      return {
        type: 'blockquote',
        children: asPmNodes(node.content).flatMap((child) => {
          const flow = pmFlow(child);
          return flow ? [flow] : [];
        }),
      };
    case 'horizontalRule':
      return { type: 'thematicBreak' };
    default:
      return null;
  }
}

export function pmJSONToMdast(doc: unknown): MdastRoot {
  const root: Root = { type: 'root', children: [] };
  if (!isPmNode(doc)) return root;
  const content = doc.type === 'doc' ? asPmNodes(doc.content) : [doc];
  for (const child of content) {
    const flow = pmFlow(child);
    if (flow) root.children.push(flow);
  }
  return root;
}
