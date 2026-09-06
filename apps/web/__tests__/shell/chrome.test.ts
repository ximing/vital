import { describe, expect, it } from 'vitest';
import { clampPaneWidth, PANE_MAX, PANE_MIN } from '../../src/shell/chrome';

describe('chrome layout', () => {
  it('clamps the second pane between min and max', () => {
    expect(clampPaneWidth(0)).toBe(PANE_MIN);
    expect(clampPaneWidth(9999)).toBe(PANE_MAX);
    expect(clampPaneWidth(240)).toBe(240);
  });
});
