import { describe, expect, it } from 'vitest';
import { shouldDragSheet, sheetSnapY } from '../../src/components/bottom-sheet-gesture';

describe('sheet and content gesture ownership', () => {
  it('expands and dismisses a half sheet from its content', () => {
    expect(shouldDragSheet(false, 0, 0, -40)).toBe(true);
    expect(shouldDragSheet(false, 0, 0, 40)).toBe(true);
  });
  it('leaves taps and horizontal movements to controls', () => {
    expect(shouldDragSheet(false, 0, 1, 3)).toBe(false);
    expect(shouldDragSheet(false, 0, 50, 20)).toBe(false);
  });
  it('scrolls full-screen content without collapsing when away from the top', () => {
    expect(shouldDragSheet(true, 120, 0, 40)).toBe(false);
    expect(shouldDragSheet(true, 0, 0, -40)).toBe(false);
  });
  it('hands a downward drag to the sheet at the top, including overscroll', () => {
    expect(shouldDragSheet(true, 0, 0, 40)).toBe(true);
    expect(shouldDragSheet(true, -10, 0, 40)).toBe(true);
  });
});

describe('release destinations', () => {
  it('returns small drags to half height, expands upward drags, and closes downward drags', () => {
    expect(sheetSnapY(340, 1000, 640)).toBe(360);
    expect(sheetSnapY(180, 1000, 640)).toBe(0);
    expect(sheetSnapY(750, 1000, 640)).toBe(1000);
  });
});
