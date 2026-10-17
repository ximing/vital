import type { ChatContext, ChatInvalidateTag, ChatPlanDiff, ChatUndoHint } from '@vital/dto';

export const CHAT_TURN_LIMIT = 60;
/**
 * Tool calls in one chat turn. Model cost stays on the agent.chat usage row.
 * Chat does not consume the background daily ledger (reserveBackgroundModelCall).
 */
export const MAX_TOOL_ROUNDS = 12;
export const CHAT_TIMEOUT_MS = 45_000;
export const PREVIEW_TTL_MS = 10 * 60_000;
/** Confirmed task plans expire after this, even if an organize preview lives longer. */
export const PLAN_TTL_MS = 15 * 60_000;
export const ORGANIZE_MAX = 20;
export const PLAN_MAX = 20;
export const HISTORY_MESSAGES = 24;
export const HISTORY_CHARS = 12_000;

export type ToolMode = 'read' | 'mutate' | 'confirm';

export type ToolResult =
  | { status: 'ok'; summary: string; data: unknown; invalidate: ChatInvalidateTag[]; undo?: ChatUndoHint }
  | {
      status: 'preview';
      summary: string;
      previewId: string;
      expiresAt: string;
      invalidate: ChatInvalidateTag[];
      diffs?: ChatPlanDiff[];
    }
  | { status: 'needs_input'; question: string }
  | { status: 'error'; code: string; summary: string };

export interface ToolCtx {
  userId: string;
  timezone: string;
  conversationId: string;
  page: ChatContext;
  gate: {
    mutated: boolean;
    /** Set while this turn is building a tasks.propose_plan. Further task mutates accumulate. */
    plan?: { previewId: string } | null;
  };
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
