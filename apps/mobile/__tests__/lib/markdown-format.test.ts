import { describe, expect, it } from 'vitest';
import { parseMarkdownToPmJSON } from '@vital/markdown';
import { applyMarkdownFormat } from '../../src/lib/markdown-format';

function marksOf(markdown: string): string[] {
  const text = parseMarkdownToPmJSON(markdown).content?.[0]?.content?.[0];
  return text?.marks?.map((mark) => mark.type) ?? [];
}

describe('applyMarkdownFormat', () => {
  it('wraps a selection in bold and toggles it off', () => {
    const wrapped = applyMarkdownFormat('今天写周报', { start: 2, end: 4 }, 'bold');
    expect(wrapped.value).toBe('今天**写周**报');
    const undone = applyMarkdownFormat(wrapped.value, wrapped.selection, 'bold');
    expect(undone.value).toBe('今天写周报');
  });

  it('prefixes each selected line as a list', () => {
    const next = applyMarkdownFormat('买菜\n做饭', { start: 0, end: 5 }, 'bullet');
    expect(next.value).toBe('- 买菜\n- 做饭');
  });

  it('inserts a link around the selection', () => {
    const next = applyMarkdownFormat('文档', { start: 0, end: 2 }, 'link', 'https://example.com');
    expect(next.value).toBe('[文档](https://example.com)');
  });

  it('sets and clears a heading on the current line', () => {
    const headed = applyMarkdownFormat('标题', { start: 1, end: 1 }, 'h2');
    expect(headed.value).toBe('## 标题');
    expect(applyMarkdownFormat(headed.value, { start: 4, end: 4 }, 'h2').value).toBe('标题');
  });

  it('wraps italic in underscores so it stays distinct from bold', () => {
    const wrapped = applyMarkdownFormat('今天写周报', { start: 2, end: 4 }, 'italic');
    expect(wrapped.value).toBe('今天_写周_报');
    expect(applyMarkdownFormat(wrapped.value, wrapped.selection, 'italic').value).toBe('今天写周报');
    expect(marksOf(applyMarkdownFormat('写', { start: 0, end: 1 }, 'italic').value)).toEqual(['italic']);
    expect(marksOf(applyMarkdownFormat('写', { start: 0, end: 1 }, 'bold').value)).toEqual(['bold']);
  });
});
