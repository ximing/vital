import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampAnchorMenu, clampCursorMenu, pointAnchor } from '../../src/ui/anchor-menu';

describe('anchor-menu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('places a cursor menu at the pointer when it fits', () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 800);
    expect(clampCursorMenu(120, 64, 208, 240)).toEqual({ left: 120, top: 64 });
  });

  it('shifts a cursor menu in from the viewport edges', () => {
    vi.stubGlobal('innerWidth', 400);
    vi.stubGlobal('innerHeight', 300);
    expect(clampCursorMenu(360, 280, 208, 240)).toEqual({ left: 184, top: 52 });
    expect(clampCursorMenu(-10, -10, 208, 240)).toEqual({ left: 8, top: 8 });
  });

  it('keeps an anchored popover beside the trigger, not on the pointer', () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 800);
    expect(clampAnchorMenu({ left: 8, top: 40, right: 220, bottom: 72 }, 208, 240)).toEqual({
      left: 228,
      top: 40,
    });
  });

  it('turns a pointer into a zero-size anchor', () => {
    expect(pointAnchor(12, 34)).toEqual({ left: 12, top: 34, right: 12, bottom: 34 });
  });
});
