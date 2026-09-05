import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify, { type Options as StringifyOptions } from 'remark-stringify';
import { unified } from 'unified';
import { remarkVitalEntity } from './remark-vital-entity.js';
import { normalizeTrailingNewlines } from './tokens.js';
import type { MdastRoot, PmNode } from './types.js';
import { mdastToPmJSON, pmJSONToMdast } from './pmjson.js';

const STRINGIFY_OPTIONS: StringifyOptions = {
  bullet: '-',
  emphasis: '_',
  strong: '*',
  fences: true,
  fence: '`',
  listItemIndent: 'one',
  rule: '-',
  incrementListMarker: true,
};

export function parseMarkdownToMdast(md: string): MdastRoot {
  return unified().use(remarkParse).use(remarkGfm).use(remarkVitalEntity).parse(md);
}

export function serializeMdastToMarkdown(tree: MdastRoot): string {
  const out = unified()
    .use(remarkGfm)
    .use(remarkVitalEntity)
    .use(remarkStringify, STRINGIFY_OPTIONS)
    .stringify(tree);
  return normalizeTrailingNewlines(out);
}

export function parseMarkdownToPmJSON(md: string): PmNode {
  return mdastToPmJSON(parseMarkdownToMdast(md));
}

export function serializePmJSONToMarkdown(doc: unknown): string {
  return serializeMdastToMarkdown(pmJSONToMdast(doc));
}
