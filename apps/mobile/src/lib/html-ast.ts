import { decodeEntities } from './html';

export type HtmlAttrs = Record<string, string>;

export type HtmlNode =
  | { type: 'text'; value: string }
  | { type: 'element'; tag: string; attrs: HtmlAttrs; children: HtmlNode[] };

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const SKIP_INNER_TAGS = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'svg']);

const ALLOWED_ATTR = new Set([
  'href',
  'title',
  'rel',
  'src',
  'alt',
  'width',
  'height',
  'poster',
  'controls',
  'playsinline',
  'type',
  'colspan',
  'rowspan',
  'scope',
  'start',
  'reversed',
  'value',
  'datetime',
  'open',
]);

export function isElement(node: HtmlNode): node is Extract<HtmlNode, { type: 'element' }> {
  return node.type === 'element';
}

export function textContent(nodes: HtmlNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else out += textContent(node.children);
  }
  return out;
}

export function parseHtml(html: string): HtmlNode[] {
  const root: Extract<HtmlNode, { type: 'element' }> = {
    type: 'element',
    tag: 'fragment',
    attrs: {},
    children: [],
  };
  const stack: Array<Extract<HtmlNode, { type: 'element' }>> = [root];
  let i = 0;
  const s = html;

  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      i = end === -1 ? s.length : end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      i = end === -1 ? s.length : end + 3;
      continue;
    }
    if (s.startsWith('<!', i) || s.startsWith('<?', i)) {
      const end = s.indexOf('>', i + 2);
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    if (s[i] !== '<') {
      const next = s.indexOf('<', i);
      const raw = s.slice(i, next === -1 ? s.length : next);
      i = next === -1 ? s.length : next;
      stack[stack.length - 1]?.children.push({ type: 'text', value: decodeEntities(raw) });
      continue;
    }

    if (s.startsWith('</', i)) {
      const close = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(s.slice(i));
      if (close === null) {
        i += 1;
        continue;
      }
      i += close[0].length;
      const tag = close[1]?.toLowerCase() ?? '';
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k]?.tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    const parsed = parseOpenTag(s, i);
    if (parsed === null) {
      i += 1;
      continue;
    }
    i = parsed.end;
    if (SKIP_INNER_TAGS.has(parsed.tag)) {
      const close = new RegExp(`</${parsed.tag}\\s*>`, 'i');
      const rest = s.slice(i);
      const match = close.exec(rest);
      i = match === null ? s.length : i + match.index + match[0].length;
      continue;
    }
    const el: Extract<HtmlNode, { type: 'element' }> = {
      type: 'element',
      tag: parsed.tag,
      attrs: parsed.attrs,
      children: [],
    };
    stack[stack.length - 1]?.children.push(el);
    if (!parsed.selfClosing && !VOID_TAGS.has(parsed.tag)) stack.push(el);
  }

  return root.children;
}

function parseOpenTag(
  html: string,
  start: number,
): { tag: string; attrs: HtmlAttrs; selfClosing: boolean; end: number } | null {
  const tagMatch = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(start));
  if (tagMatch === null || tagMatch[1] === undefined) return null;
  const tag = tagMatch[1].toLowerCase();
  let i = start + tagMatch[0].length;
  const attrs: HtmlAttrs = {};
  let selfClosing = false;

  while (i < html.length) {
    const ws = /^\s+/.exec(html.slice(i));
    if (ws !== null) i += ws[0].length;
    if (html[i] === '>') {
      i += 1;
      break;
    }
    if (html.startsWith('/>', i)) {
      selfClosing = true;
      i += 2;
      break;
    }
    const attr = /^([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/.exec(html.slice(i));
    if (attr === null || attr[1] === undefined) {
      i += 1;
      continue;
    }
    i += attr[0].length;
    const name = attr[1].toLowerCase();
    if (name.startsWith('on') || !ALLOWED_ATTR.has(name)) continue;
    attrs[name] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '');
  }

  return { tag, attrs, selfClosing, end: i };
}
