import { describe, expect, it } from 'vitest';
import { isTypingTarget, moveSelection } from '../../../src/features/todos/keyboard';

describe('todo keyboard helpers', () => {
  it('treats input textarea and contenteditable as typing', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    const button = document.createElement('button');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(div)).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
  });

  it('moves j/k selection with clamp', () => {
    expect(moveSelection(['a', 'b', 'c'], null, 1)).toBe('a');
    expect(moveSelection(['a', 'b', 'c'], null, -1)).toBe('c');
    expect(moveSelection(['a', 'b', 'c'], 'a', 1)).toBe('b');
    expect(moveSelection(['a', 'b', 'c'], 'c', 1)).toBe('c');
    expect(moveSelection(['a', 'b', 'c'], 'a', -1)).toBe('a');
  });
});
