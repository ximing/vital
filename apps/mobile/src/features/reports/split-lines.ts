import type { EntityToken, RenderPart } from '@vital/markdown';

export type InlinePart =
  | { type: 'text'; value: string }
  | { type: 'entity'; token: EntityToken };

export function renderPartsToLines(parts: RenderPart[]): InlinePart[][] {
  const lines: InlinePart[][] = [[]];

  function last(): InlinePart[] {
    const row = lines[lines.length - 1];
    if (row !== undefined) return row;
    const next: InlinePart[] = [];
    lines.push(next);
    return next;
  }

  for (const part of parts) {
    if (part.type === 'entity') {
      last().push({ type: 'entity', token: part.token });
      continue;
    }
    const chunks = part.value.split('\n');
    chunks.forEach((chunk, index) => {
      if (index > 0) lines.push([]);
      if (chunk !== '') last().push({ type: 'text', value: chunk });
    });
  }
  return lines;
}
