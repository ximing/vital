import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseMarkdownToMdast,
  parseMarkdownToPmJSON,
  serializeMdastToMarkdown,
  serializePmJSONToMarkdown,
} from '../src/pipeline.js';
import { isRecord, isVitalEntity, type MdastRoot, type PmNode } from '../src/types.js';
import { mdastToPmJSON, pmJSONToMdast } from '../src/pmjson.js';

function walkMdast(node: unknown, visitFn: (n: unknown) => void): void {
  visitFn(node);
  if (!isRecord(node) || !Array.isArray(node.children)) return;
  for (const child of node.children) walkMdast(child, visitFn);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixtures(): { name: string; md: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      name,
      md: readFileSync(join(dir, name), 'utf8'),
    }));
}

function roundTripMd(md: string): string {
  const first = serializeMdastToMarkdown(parseMarkdownToMdast(md));
  const second = serializeMdastToMarkdown(parseMarkdownToMdast(first));
  return second;
}

function roundTripPm(md: string): string {
  const first = serializePmJSONToMarkdown(parseMarkdownToPmJSON(md));
  const second = serializePmJSONToMarkdown(parseMarkdownToPmJSON(first));
  return second;
}

function collectEntityPm(node: PmNode, acc: PmNode[]): void {
  if (node.type === 'vitalEntity') acc.push(node);
  for (const child of node.content ?? []) collectEntityPm(child, acc);
}

describe('golden fixtures: source ↔ WYSIWYG twice', () => {
  it.each(loadFixtures())('$name mdast twice and pm twice', ({ md }) => {
    const canonical = serializeMdastToMarkdown(parseMarkdownToMdast(md));
    expect(roundTripMd(md)).toBe(canonical);
    expect(roundTripPm(md)).toBe(canonical);
    const pm = parseMarkdownToPmJSON(canonical);
    expect(mdastToPmJSON(pmJSONToMdast(pm))).toEqual(pm);
  });

  it('does not leak checkbox markers from EntityChip', () => {
    const chips = readFileSync(join(dir, 'chips.md'), 'utf8');
    const md = serializeMdastToMarkdown(parseMarkdownToMdast(chips));
    expect(md.includes('[ ]')).toBe(false);
    expect(md.includes('[x]')).toBe(false);
    const tree: MdastRoot = parseMarkdownToMdast(chips);
    const kinds: string[] = [];
    walkMdast(tree, (node) => {
      if (isVitalEntity(node)) kinds.push(node.kind);
    });
    expect(kinds).toEqual(['task', 'task', 'inbox', 'task']);
    const entities: PmNode[] = [];
    collectEntityPm(parseMarkdownToPmJSON(chips), entities);
    expect(entities.every((n) => n.type === 'vitalEntity')).toBe(true);
    expect(serializePmJSONToMarkdown({ type: 'doc', content: entities.map((n) => ({ type: 'paragraph', content: [n] })) }).includes('[ ]')).toBe(false);
  });

  it('normalizes trailing newlines to one', () => {
    const md = '# Hi\n\n\n';
    expect(serializeMdastToMarkdown(parseMarkdownToMdast(md))).toBe('# Hi\n');
  });
});
