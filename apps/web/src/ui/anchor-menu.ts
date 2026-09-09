export type MenuAnchor = { left: number; top: number; right: number; bottom: number };

const EDGE = 8;

/** Place a fixed menu to the right of `anchor`, flipping left / up if it would overflow. */
export function clampAnchorMenu(
  anchor: MenuAnchor,
  width: number,
  height: number,
  gap = 8,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + gap;
  if (left + width > vw - EDGE) left = Math.max(EDGE, anchor.left - width - gap);
  let top = anchor.top;
  if (top + height > vh - EDGE) top = Math.max(EDGE, vh - height - EDGE);
  if (top < EDGE) top = EDGE;
  return { left, top };
}

/** Place a fixed menu at the pointer, shifting in if it would overflow the viewport. */
export function clampCursorMenu(
  x: number,
  y: number,
  width: number,
  height: number,
): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
    top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
  };
}

export function pointAnchor(x: number, y: number): MenuAnchor {
  return { left: x, top: y, right: x, bottom: y };
}
