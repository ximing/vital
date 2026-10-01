import type { ChatContext, ChatInvalidateTag, ChatUndoHint } from '@vital/dto';

export const CHAT_TURN_LIMIT = 60;
export const MAX_TOOL_ROUNDS = 4;
export const CHAT_TIMEOUT_MS = 45_000;
export const PREVIEW_TTL_MS = 10 * 60_000;
export const ORGANIZE_MAX = 20;
export const HISTORY_MESSAGES = 24;
export const HISTORY_CHARS = 12_000;

export type ToolMode = 'read' | 'mutate' | 'confirm';

export type ToolResult =
  | { status: 'ok'; summary: string; data: unknown; invalidate: ChatInvalidateTag[]; undo?: ChatUndoHint }
  | { status: 'preview'; summary: string; previewId: string; expiresAt: string; invalidate: ChatInvalidateTag[] }
  | { status: 'needs_input'; question: string }
  | { status: 'error'; code: string; summary: string };

export interface ToolCtx {
  userId: string;
  timezone: string;
  conversationId: string;
  page: ChatContext;
  gate: { mutated: boolean };
  domainMutated: { value: boolean };
}

export function needsInput(question: string): ToolResult {
  return { status: 'needs_input', question };
}

export function toolError(code: string, summary: string): ToolResult {
  return { status: 'error', code, summary };
}

export function okResult(
  summary: string,
  data: unknown,
  invalidate: ChatInvalidateTag[],
  undo?: ChatUndoHint,
): ToolResult {
  return { status: 'ok', summary, data, invalidate, ...(undo ? { undo } : {}) };
}
