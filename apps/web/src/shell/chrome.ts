export const RAIL_EXPANDED = 152;
export const RAIL_COLLAPSED = 56;
export const PANE_MIN = 196;
export const PANE_MAX = 420;
export const PANE_DEFAULT = 256;

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
