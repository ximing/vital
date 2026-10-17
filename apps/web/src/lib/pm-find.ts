import type { Node as PmNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { findKeywordMatches } from '@vital/article-doc';

export type PmMatch = { from: number; to: number };

export type DocFindState = {
  query: string;
  matchCase: boolean;
  index: number;
  active: boolean;
};

const EMPTY_FIND: DocFindState = { query: '', matchCase: false, index: 0, active: false };

const GAP = '\u0000';

export const docFindPluginKey = new PluginKey<DocFindState>('docFind');

type Seg = { pos: number; text: string };

/** Keyword matches in ProseMirror positions. A match stays inside one text block. */
export function findInPmDoc(doc: PmNode, query: string, matchCase: boolean): PmMatch[] {
  if (query.length === 0) return [];
  const matches: PmMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const segs: Seg[] = [];
    node.forEach((child, offset) => {
      const childPos = pos + 1 + offset;
      if (child.isText) {
        segs.push({ pos: childPos, text: child.text ?? '' });
        return;
      }
      if (child.type.name === 'hardBreak') {
        segs.push({ pos: childPos, text: '\n' });
        return;
      }
      segs.push({ pos: childPos, text: GAP });
    });
    const flat = segs.map((seg) => seg.text).join('');
    for (const match of findKeywordMatches(flat, query, matchCase)) {
      const slice = flat.slice(match.start, match.end);
      if (slice.includes(GAP)) continue;
      const from = flatPos(segs, match.start);
      const to = flatPos(segs, match.end);
      if (from === null || to === null || from >= to) continue;
      matches.push({ from, to });
    }
    return false;
  });
  return matches;
}

export function replaceMatchesInTransaction(
  tr: Transaction,
  matches: PmMatch[],
  replacement: string,
): Transaction {
  for (const match of [...matches].reverse()) {
    tr.insertText(replacement, match.from, match.to);
  }
  return tr;
}

export function indexAtOrAfter(matches: PmMatch[], pos: number): number {
  if (matches.length === 0) return 0;
  const index = matches.findIndex((match) => match.from >= pos);
  return index === -1 ? 0 : index;
}

function flatPos(segs: Seg[], index: number): number | null {
  let cursor = 0;
  for (const seg of segs) {
    const next = cursor + seg.text.length;
    if (index >= cursor && index <= next) return seg.pos + (index - cursor);
    cursor = next;
  }
  return null;
}

function inlineRanges(doc: PmNode, from: number, to: number): PmMatch[] {
  const ranges: PmMatch[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || node.text === undefined) return;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.text.length, to);
    if (start < end) ranges.push({ from: start, to: end });
  });
  return ranges;
}

export function createDocFindExtension(): Extension {
  return Extension.create({
    name: 'docFind',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: docFindPluginKey,
          state: {
            init: () => EMPTY_FIND,
            apply(tr, prev) {
              const meta = tr.getMeta(docFindPluginKey) as Partial<DocFindState> | undefined;
              if (!meta) return prev;
              return { ...prev, ...meta };
            },
          },
          props: {
            decorations(state) {
              const cfg = docFindPluginKey.getState(state) ?? EMPTY_FIND;
              if (!cfg.active || cfg.query === '') return null;
              const matches = findInPmDoc(state.doc, cfg.query, cfg.matchCase);
              if (matches.length === 0) return null;
              const current = Math.min(Math.max(cfg.index, 0), matches.length - 1);
              const decos = matches.flatMap((match, index) => {
                const currentHit = index === current;
                const attrs: { class: string; 'data-find-current'?: string } = {
                  class: currentHit ? 'doc-find-hit doc-find-hit-current' : 'doc-find-hit',
                };
                if (currentHit) attrs['data-find-current'] = 'true';
                return inlineRanges(state.doc, match.from, match.to).map((range) =>
                  Decoration.inline(range.from, range.to, attrs),
                );
              });
              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ];
    },
  });
}
