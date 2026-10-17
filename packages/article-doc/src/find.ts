import type {
  ArticleBlockNode,
  ArticleDoc,
  ArticleInlineNode,
  ArticleMark,
  ArticleTextNode,
} from './types.js';

export type KeywordMatch = { start: number; end: number };

export type ArticleFindOptions = { matchCase: boolean };

export type ArticleFindHit = {
  index: number;
  path: number[];
  start: number;
  end: number;
};

export type ArticleReplaceOptions = ArticleFindOptions & {
  /** A match index in reading order, or every match. */
  occurrence: number | 'all';
};

const GAP = '\u0000';

export function pathKey(path: number[]): string {
  return path.join('.');
}

export function comparePath(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? -1) - (b[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Next hit at or after `end` in the same block, otherwise the next block, wrapping to 0. */
export function indexAfterArticleReplace(
  hits: ArticleFindHit[],
  path: number[],
  end: number,
): number {
  if (hits.length === 0) return 0;
  const index = hits.findIndex(
    (hit) =>
      comparePath(hit.path, path) > 0 || (comparePath(hit.path, path) === 0 && hit.start >= end),
  );
  return index === -1 ? 0 : index;
}

/** Literal keyword matches. Empty query matches nothing. Matches do not overlap. */
export function findKeywordMatches(
  text: string,
  query: string,
  matchCase: boolean,
): KeywordMatch[] {
  if (query.length === 0 || query.includes(GAP) || text.length < query.length) return [];
  const matches: KeywordMatch[] = [];
  const step = query.length;
  for (let i = 0; i <= text.length - query.length;) {
    if (equalsAt(text, query, i, matchCase)) {
      matches.push({ start: i, end: i + step });
      i += step;
    } else {
      i += 1;
    }
  }
  return matches;
}

function equalsAt(text: string, query: string, index: number, matchCase: boolean): boolean {
  if (matchCase) return text.startsWith(query, index);
  const slice = text.slice(index, index + query.length);
  const left = slice.toLowerCase();
  const right = query.toLowerCase();
  // toLowerCase can change length (ß). Skip those so indexes stay aligned.
  return left.length === right.length && left === right;
}

/**
 * Keyword hits in reading order. A hit stays inside one paragraph, heading,
 * list item, table cell, or code block, and may cross inline marks.
 */
export function findInArticleDoc(
  doc: ArticleDoc,
  query: string,
  options: ArticleFindOptions,
): ArticleFindHit[] {
  const hits: ArticleFindHit[] = [];
  visitBlocks(doc.content, [], (path, text) => {
    for (const match of findKeywordMatches(text, query, options.matchCase)) {
      hits.push({ index: hits.length, path, start: match.start, end: match.end });
    }
  });
  return hits;
}

export function replaceInArticleDoc(
  doc: ArticleDoc,
  query: string,
  replacement: string,
  options: ArticleReplaceOptions,
): { doc: ArticleDoc; replaced: number } {
  if (query.length === 0 || query.includes(GAP)) return { doc, replaced: 0 };
  const counter = { seen: 0, replaced: 0 };
  const content = mapBlocks(doc.content, [], query, replacement, options, counter);
  if (counter.replaced === 0) return { doc, replaced: 0 };
  return { doc: { type: 'doc', content }, replaced: counter.replaced };
}

function visitBlocks(
  blocks: ArticleBlockNode[],
  path: number[],
  visit: (path: number[], text: string) => void,
): void {
  blocks.forEach((block, index) => {
    const next = [...path, index];
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        visit(next, piecesToText(inlineToPieces(block.content)));
        break;
      case 'codeBlock':
        visit(next, block.content.map((node) => node.text).join(''));
        break;
      case 'blockquote':
        visitBlocks(block.content, next, visit);
        break;
      case 'bulletList':
      case 'orderedList':
        block.content.forEach((item, itemIndex) => {
          visitBlocks(item.content, [...next, itemIndex], visit);
        });
        break;
      case 'table':
        block.content.forEach((row, rowIndex) => {
          row.content.forEach((cell, cellIndex) => {
            visitBlocks(cell.content, [...next, rowIndex, cellIndex], visit);
          });
        });
        break;
      default:
        break;
    }
  });
}

type Counter = { seen: number; replaced: number };

function mapBlocks(
  blocks: ArticleBlockNode[],
  path: number[],
  query: string,
  replacement: string,
  options: ArticleReplaceOptions,
  counter: Counter,
): ArticleBlockNode[] {
  return mapSame(blocks, (block, index) => {
    const next = [...path, index];
    switch (block.type) {
      case 'paragraph':
      case 'heading': {
        const content = replaceInline(block.content, query, replacement, options, counter);
        return content === block.content ? block : { ...block, content };
      }
      case 'codeBlock': {
        const content = replaceCode(block.content, query, replacement, options, counter);
        return content === block.content ? block : { ...block, content };
      }
      case 'blockquote': {
        const content = mapBlocks(block.content, next, query, replacement, options, counter);
        return content === block.content ? block : { ...block, content };
      }
      case 'bulletList':
      case 'orderedList': {
        const content = mapSame(block.content, (item, itemIndex) => {
          const itemContent = mapBlocks(
            item.content,
            [...next, itemIndex],
            query,
            replacement,
            options,
            counter,
          );
          return itemContent === item.content ? item : { ...item, content: itemContent };
        });
        return content === block.content ? block : { ...block, content };
      }
      case 'table': {
        const content = mapSame(block.content, (row, rowIndex) => {
          const cells = mapSame(row.content, (cell, cellIndex) => {
            const cellContent = mapBlocks(
              cell.content,
              [...next, rowIndex, cellIndex],
              query,
              replacement,
              options,
              counter,
            );
            return cellContent === cell.content ? cell : { ...cell, content: cellContent };
          });
          return cells === row.content ? row : { ...row, content: cells };
        });
        return content === block.content ? block : { ...block, content };
      }
      default:
        return block;
    }
  });
}

function replaceInline(
  nodes: ArticleInlineNode[],
  query: string,
  replacement: string,
  options: ArticleReplaceOptions,
  counter: Counter,
): ArticleInlineNode[] {
  const pieces = inlineToPieces(nodes);
  const text = piecesToText(pieces);
  const chosen = takeMatches(
    findKeywordMatches(text, query, options.matchCase),
    counter,
    options.occurrence,
  );
  if (chosen.length === 0) return nodes;
  return coalesce(applyRanges(explode(pieces), chosen, replacement));
}

function replaceCode(
  nodes: ArticleTextNode[],
  query: string,
  replacement: string,
  options: ArticleReplaceOptions,
  counter: Counter,
): ArticleTextNode[] {
  const text = nodes.map((node) => node.text).join('');
  const chosen = takeMatches(
    findKeywordMatches(text, query, options.matchCase),
    counter,
    options.occurrence,
  );
  if (chosen.length === 0) return nodes;
  let next = text;
  for (const range of [...chosen].reverse()) {
    next = next.slice(0, range.start) + replacement + next.slice(range.end);
  }
  if (next === '') return [];
  return [{ type: 'text', text: next }];
}

function takeMatches(
  matches: KeywordMatch[],
  counter: Counter,
  occurrence: number | 'all',
): KeywordMatch[] {
  const chosen: KeywordMatch[] = [];
  for (const match of matches) {
    const index = counter.seen;
    counter.seen += 1;
    if (occurrence === 'all' || index === occurrence) {
      chosen.push(match);
      counter.replaced += 1;
    }
  }
  return chosen;
}

type Piece = { kind: 'text'; text: string; marks?: ArticleMark[] } | { kind: 'break' };

type Unit = { kind: 'text'; ch: string; marks?: ArticleMark[] } | { kind: 'break' };

function inlineToPieces(nodes: ArticleInlineNode[]): Piece[] {
  const pieces: Piece[] = [];
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      pieces.push({ kind: 'break' });
      continue;
    }
    if (node.text === '') continue;
    const prev = pieces[pieces.length - 1];
    if (prev && prev.kind === 'text' && marksKey(prev.marks) === marksKey(node.marks)) {
      prev.text += node.text;
      continue;
    }
    pieces.push(
      node.marks && node.marks.length > 0
        ? { kind: 'text', text: node.text, marks: node.marks }
        : { kind: 'text', text: node.text },
    );
  }
  return pieces;
}

function piecesToText(pieces: Piece[]): string {
  let text = '';
  for (const piece of pieces) text += piece.kind === 'break' ? '\n' : piece.text;
  return text;
}

function explode(pieces: Piece[]): Unit[] {
  const units: Unit[] = [];
  for (const piece of pieces) {
    if (piece.kind === 'break') {
      units.push({ kind: 'break' });
      continue;
    }
    for (let i = 0; i < piece.text.length; i += 1) {
      const ch = piece.text[i] ?? '';
      units.push(
        piece.marks && piece.marks.length > 0
          ? { kind: 'text', ch, marks: piece.marks }
          : { kind: 'text', ch },
      );
    }
  }
  return units;
}

function applyRanges(units: Unit[], ranges: KeywordMatch[], replacement: string): Unit[] {
  const next = units.slice();
  for (const range of [...ranges].reverse()) {
    let marks: ArticleMark[] | undefined;
    for (let i = range.start; i < range.end; i += 1) {
      const unit = next[i];
      if (unit && unit.kind === 'text') {
        marks = unit.marks;
        break;
      }
    }
    const inserted: Unit[] = [];
    for (let i = 0; i < replacement.length; i += 1) {
      const ch = replacement[i] ?? '';
      inserted.push(marks && marks.length > 0 ? { kind: 'text', ch, marks } : { kind: 'text', ch });
    }
    next.splice(range.start, range.end - range.start, ...inserted);
  }
  return next;
}

function coalesce(units: Unit[]): ArticleInlineNode[] {
  const nodes: ArticleInlineNode[] = [];
  for (const unit of units) {
    if (unit.kind === 'break') {
      nodes.push({ type: 'hardBreak' });
      continue;
    }
    const prev = nodes[nodes.length - 1];
    if (prev && prev.type === 'text' && marksKey(prev.marks) === marksKey(unit.marks)) {
      prev.text += unit.ch;
      continue;
    }
    if (unit.marks && unit.marks.length > 0) {
      nodes.push({ type: 'text', text: unit.ch, marks: unit.marks });
    } else {
      nodes.push({ type: 'text', text: unit.ch });
    }
  }
  return nodes;
}

function marksKey(marks: ArticleMark[] | undefined): string {
  if (marks === undefined || marks.length === 0) return '';
  return JSON.stringify(marks);
}

function mapSame<T>(items: T[], map: (item: T, index: number) => T): T[] {
  const next = items.map(map);
  for (let i = 0; i < items.length; i += 1) {
    if (next[i] !== items[i]) return next;
  }
  return items;
}
