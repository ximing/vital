export const RAIL_EXPANDED = 56;
export const RAIL_COLLAPSED = 56;
export const RAIL_WIDTH = 56;
export const LIBRARY_MIN = 224;
export const LIBRARY_MAX = 264;
export const LIBRARY_DEFAULT = 248;
export const PANE_MIN = LIBRARY_MIN;
export const PANE_MAX = LIBRARY_MAX;
export const PANE_DEFAULT = LIBRARY_DEFAULT;

const RAIL_KEY = 'vital:rail-collapsed';
const PANE_KEY = 'vital:pane-width';

export function clampPaneWidth(n: number): number {
  return Math.min(PANE_MAX, Math.max(PANE_MIN, Math.round(n)));
}

export function loadRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0');
  } catch {
    // Private mode.
  }
}

export function loadPaneWidth(): number {
  try {
    const raw = localStorage.getItem(PANE_KEY);
    if (raw === null) return PANE_DEFAULT;
    const n = Number(raw);
    if (Number.isFinite(n)) return clampPaneWidth(n);
  } catch {
    // Private mode.
  }
  return PANE_DEFAULT;
}

export function savePaneWidth(width: number): void {
  try {
    localStorage.setItem(PANE_KEY, String(clampPaneWidth(width)));
  } catch {
    // Private mode.
  }
}
