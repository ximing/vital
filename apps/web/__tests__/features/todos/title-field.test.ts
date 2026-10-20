import { describe, expect, it, vi } from 'vitest';
import { fitTextareaLines } from '../../../src/features/todos/title-field';

function textarea(): HTMLTextAreaElement {
  const node = document.createElement('textarea');
  document.body.appendChild(node);
  return node;
}

describe('fitTextareaLines', () => {
  it('grows with the text and stops at three lines', () => {
    const node = textarea();
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '28px',
    } as CSSStyleDeclaration);
    try {
      Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => 28 });
      fitTextareaLines(node, 3);
      expect(node.style.height).toBe('28px');
      expect(node.style.overflowY).toBe('hidden');

      Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => 56 });
      fitTextareaLines(node, 3);
      expect(node.style.height).toBe('56px');
      expect(node.style.overflowY).toBe('hidden');

      Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => 200 });
      fitTextareaLines(node, 3);
      expect(node.style.height).toBe('84px');
      expect(node.style.overflowY).toBe('auto');
    } finally {
      spy.mockRestore();
      node.remove();
    }
  });

  it('does nothing when line-height is not a length', () => {
    const node = textarea();
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: 'normal',
    } as CSSStyleDeclaration);
    try {
      fitTextareaLines(node, 3);
      expect(node.style.height).toBe('');
    } finally {
      spy.mockRestore();
      node.remove();
    }
  });
});
