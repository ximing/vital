export type TextSelection = { start: number; end: number };

export type FormatAction =
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'codeBlock'
  | 'link';

const INLINE: Record<'bold' | 'italic' | 'strike' | 'code', [string, string]> = {
  bold: ['**', '**'],
  // Underscore matches the markdown serializer (emphasis: '_'). A single * collides with **bold**.
  italic: ['_', '_'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
};

function clamp(value: string, selection: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(selection.start, selection.end, value.length));
  const end = Math.min(value.length, Math.max(selection.start, selection.end, start));
  return { start, end };
}

function lineBounds(value: string, selection: TextSelection): { start: number; end: number } {
  const start = value.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1;
  const found = value.indexOf('\n', selection.end);
  const end = found === -1 ? value.length : found;
  return { start, end };
}

function replaceBlock(
  value: string,
  bounds: { start: number; end: number },
  nextBlock: string,
): { value: string; selection: TextSelection } {
  const next = value.slice(0, bounds.start) + nextBlock + value.slice(bounds.end);
  return { value: next, selection: { start: bounds.start, end: bounds.start + nextBlock.length } };
}

function toggleWrap(
  value: string,
  selection: TextSelection,
  open: string,
  close: string,
): { value: string; selection: TextSelection } {
  const selected = value.slice(selection.start, selection.end);
  const before = value.slice(Math.max(0, selection.start - open.length), selection.start);
  const after = value.slice(selection.end, selection.end + close.length);
  if (before === open && after === close) {
    const next =
      value.slice(0, selection.start - open.length) + selected + value.slice(selection.end + close.length);
    const start = selection.start - open.length;
    return { value: next, selection: { start, end: start + selected.length } };
  }
  const inner = selected === '' ? '文字' : selected;
  const next = value.slice(0, selection.start) + open + inner + close + value.slice(selection.end);
  const start = selection.start + open.length;
  return { value: next, selection: { start, end: start + inner.length } };
}

function mapLines(
  value: string,
  selection: TextSelection,
  map: (line: string, index: number) => string,
): { value: string; selection: TextSelection } {
  const bounds = lineBounds(value, selection);
  const lines = value.slice(bounds.start, bounds.end).split('\n');
  return replaceBlock(value, bounds, lines.map(map).join('\n'));
}

function headingLevel(line: string): number {
  const match = /^(#{1,6}) /.exec(line);
  return match?.[1]?.length ?? 0;
}

function setHeading(line: string, level: 2 | 3): string {
  const body = line.replace(/^(#{1,6}) /, '');
  if (headingLevel(line) === level) return body;
  return `${'#'.repeat(level)} ${body}`;
}

/** Insert or toggle markdown around the current selection. The returned selection covers the affected text. */
export function applyMarkdownFormat(
  value: string,
  rawSelection: TextSelection,
  action: FormatAction,
  linkHref = '',
): { value: string; selection: TextSelection } {
  const selection = clamp(value, rawSelection);
  if (action === 'bold' || action === 'italic' || action === 'strike' || action === 'code') {
    const [open, close] = INLINE[action];
    return toggleWrap(value, selection, open, close);
  }
  if (action === 'h2' || action === 'h3') {
    const level = action === 'h2' ? 2 : 3;
    return mapLines(value, selection, (line) => setHeading(line, level));
  }
  if (action === 'bullet') {
    return mapLines(value, selection, (line) =>
      line.startsWith('- ') ? line.slice(2) : `- ${line}`,
    );
  }
  if (action === 'ordered') {
    const bounds = lineBounds(value, selection);
    const lines = value.slice(bounds.start, bounds.end).split('\n');
    const numbered = lines.every((line) => /^\d+\. /.test(line));
    const next = numbered
      ? lines.map((line) => line.replace(/^\d+\. /, ''))
      : lines.map((line, index) => `${String(index + 1)}. ${line.replace(/^\d+\. /, '')}`);
    return replaceBlock(value, bounds, next.join('\n'));
  }
  if (action === 'quote') {
    return mapLines(value, selection, (line) =>
      line.startsWith('> ') ? line.slice(2) : `> ${line}`,
    );
  }
  if (action === 'codeBlock') {
    const selected = value.slice(selection.start, selection.end);
    const fence = selected.startsWith('```') && selected.endsWith('```') ? selected : null;
    if (fence !== null) {
      const inner = fence.slice(3, -3).replace(/^\n/, '').replace(/\n$/, '');
      const next = value.slice(0, selection.start) + inner + value.slice(selection.end);
      return {
        value: next,
        selection: { start: selection.start, end: selection.start + inner.length },
      };
    }
    const inner = selected === '' ? '' : selected;
    const block = `\`\`\`\n${inner}\n\`\`\``;
    const next = value.slice(0, selection.start) + block + value.slice(selection.end);
    const start = selection.start + 4;
    return { value: next, selection: { start, end: start + inner.length } };
  }
  const href = linkHref.trim();
  if (href === '') return { value, selection };
  const label = value.slice(selection.start, selection.end) || '链接';
  const block = `[${label}](${href})`;
  const next = value.slice(0, selection.start) + block + value.slice(selection.end);
  const start = selection.start + 1;
  return { value: next, selection: { start, end: start + label.length } };
}
