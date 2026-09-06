import { describe, expect, it } from 'vitest';
import {
  clampPaneWidth,
  LIBRARY_DEFAULT,
  LIBRARY_MAX,
  LIBRARY_MIN,
  PANE_MAX,
  PANE_MIN,
} from '../../src/shell/chrome';

describe('chrome layout', () => {
  it('clamps the second pane between min and max', () => {
    expect(clampPaneWidth(0)).toBe(PANE_MIN);
    expect(clampPaneWidth(9999)).toBe(PANE_MAX);
    expect(clampPaneWidth(240)).toBe(240);
  });

  it('uses the Mineral Garden library range', () => {
    expect(LIBRARY_MIN).toBe(224);
    expect(LIBRARY_DEFAULT).toBe(248);
    expect(LIBRARY_MAX).toBe(264);
    expect(clampPaneWidth(0)).toBe(LIBRARY_MIN);
    expect(clampPaneWidth(9999)).toBe(264);
  });
});
