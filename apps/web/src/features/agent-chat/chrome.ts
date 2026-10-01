export const AGENT_CHAT_WIDTH_DEFAULT = 360;
export const AGENT_CHAT_WIDTH_MIN = 300;
export const AGENT_CHAT_WIDTH_MAX = 520;
/** Viewport narrower than this opens the assistant as an overlay. */
export const AGENT_CHAT_DOCK_MIN_PX = 1100;

const WIDTH_KEY = 'vital:agent-chat-width';
const OPEN_KEY = 'vital:agent-chat-open';

export function clampAgentChatWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_CHAT_WIDTH_DEFAULT;
  return Math.min(AGENT_CHAT_WIDTH_MAX, Math.max(AGENT_CHAT_WIDTH_MIN, Math.round(width)));
}

/** Panel sits on the right: dragging the left edge leftward increases width. */
export function agentChatWidthFromDrag(startWidth: number, startX: number, clientX: number): number {
  return startWidth + (startX - clientX);
}

export function agentChatWidthFromKey(current: number, key: string, step = 16): number | null {
  if (key === 'ArrowLeft') return current + step;
  if (key === 'ArrowRight') return current - step;
  if (key === 'Home') return AGENT_CHAT_WIDTH_MAX;
  if (key === 'End') return AGENT_CHAT_WIDTH_MIN;
  return null;
}

export function loadAgentChatWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw == null || raw === '') return AGENT_CHAT_WIDTH_DEFAULT;
    return clampAgentChatWidth(Number(raw));
  } catch {
    return AGENT_CHAT_WIDTH_DEFAULT;
  }
}

export function saveAgentChatWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(clampAgentChatWidth(width)));
  } catch {
    // Private mode.
  }
}

export function loadAgentChatOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAgentChatOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Private mode.
  }
}
