export const RAIL_EXPANDED = 56;
export const RAIL_COLLAPSED = 56;
export const RAIL_WIDTH = 56;
export const LIBRARY_MIN = 224;
export const LIBRARY_MAX = 264;
export const LIBRARY_DEFAULT = 248;
export const CAPTURE_MIN = 224;
export const CAPTURE_MAX = 264;
export const CAPTURE_DEFAULT = 248;

export const INBOX_LIST_MIN = 320;
export const INBOX_LIST_MAX = 520;
export const INBOX_LIST_DEFAULT = 360;
const INBOX_LIST_KEY = 'vital:pane-width:inbox-list';

export function clampInboxListWidth(n: number): number {
  return Math.min(INBOX_LIST_MAX, Math.max(INBOX_LIST_MIN, Math.round(n)));
}

export function loadInboxListWidth(): number {
  try {
    const raw = localStorage.getItem(INBOX_LIST_KEY);
    if (raw === null) return INBOX_LIST_DEFAULT;
    const n = Number(raw);
    if (Number.isFinite(n)) return clampInboxListWidth(n);
  } catch {
    // Private mode.
  }
  return INBOX_LIST_DEFAULT;
}

export function saveInboxListWidth(width: number): void {
  try {
    localStorage.setItem(INBOX_LIST_KEY, String(clampInboxListWidth(width)));
  } catch {
    // Private mode.
  }
}

export type PaneSection = 'todos' | 'capture' | 'reflect';

const RANGES: Record<PaneSection, { min: number; max: number; def: number }> = {
  todos: { min: LIBRARY_MIN, max: LIBRARY_MAX, def: LIBRARY_DEFAULT },
  capture: { min: CAPTURE_MIN, max: CAPTURE_MAX, def: CAPTURE_DEFAULT },
  reflect: { min: LIBRARY_MIN, max: LIBRARY_MAX, def: LIBRARY_DEFAULT },
};

const RAIL_KEY = 'vital:rail-collapsed';

function paneKey(section: PaneSection): string {
  return `vital:pane-width:${section}`;
}

export function clampPaneWidth(n: number, section: PaneSection = 'todos'): number {
  const { min, max } = RANGES[section];
  return Math.min(max, Math.max(min, Math.round(n)));
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

export function loadPaneWidth(section: PaneSection): number {
  try {
    const raw = localStorage.getItem(paneKey(section));
    if (raw === null) return RANGES[section].def;
    const n = Number(raw);
    if (Number.isFinite(n)) return clampPaneWidth(n, section);
  } catch {
    // Private mode.
  }
  return RANGES[section].def;
}

export function savePaneWidth(section: PaneSection, width: number): void {
  try {
    localStorage.setItem(paneKey(section), String(clampPaneWidth(width, section)));
  } catch {
    // Private mode.
  }
}
