import { describe, expect, it } from 'vitest';
import {
  CAPTURE_DEFAULT,
  CAPTURE_MAX,
  CAPTURE_MIN,
  clampPaneWidth,
  LIBRARY_DEFAULT,
  LIBRARY_MAX,
  LIBRARY_MIN,
} from '../../src/shell/chrome';

describe('chrome layout', () => {
  it('clamps the library pane between min and max', () => {
    expect(clampPaneWidth(0)).toBe(LIBRARY_MIN);
    expect(clampPaneWidth(9999)).toBe(LIBRARY_MAX);
    expect(clampPaneWidth(240)).toBe(240);
  });

  it('clamps the capture pane in its own wider range', () => {
    expect(clampPaneWidth(0, 'capture')).toBe(CAPTURE_MIN);
    expect(clampPaneWidth(9999, 'capture')).toBe(CAPTURE_MAX);
    expect(clampPaneWidth(300, 'capture')).toBe(CAPTURE_MIN);
    expect(clampPaneWidth(240, 'reflect')).toBe(240);
  });

  it('uses the Mineral Garden library range', () => {
    expect(LIBRARY_MIN).toBe(224);
    expect(LIBRARY_DEFAULT).toBe(248);
    expect(LIBRARY_MAX).toBe(264);
  });

  it('gives the capture pane a wider range', () => {
    expect(CAPTURE_MIN).toBe(336);
    expect(CAPTURE_DEFAULT).toBe(372);
    expect(CAPTURE_MAX).toBe(396);
  });
});
