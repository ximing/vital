/** Decide whether a vertical movement belongs to the sheet or its scrollable content. */
export function shouldDragSheet(full: boolean, scrollY: number, dx: number, dy: number): boolean {
  if (Math.abs(dy) < 6 || Math.abs(dx) > Math.abs(dy)) return false;
  return !full || (dy > 6 && scrollY <= 0);
}

export function sheetSnapY(y: number, fullH: number, midH: number): number {
  const height = fullH - y;
  if (height < midH * 0.55) return fullH;
  if (height > midH + (fullH - midH) * 0.35) return 0;
  return fullH - midH;
}
