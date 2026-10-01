import { z } from 'zod';

export const chatInvalidateTagSchema = z.enum(['tasks', 'habits', 'today', 'inbox', 'reports', 'days', 'outcomes']);
export type ChatInvalidateTag = z.infer<typeof chatInvalidateTagSchema>;

export const chatUndoHintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uncomplete'), taskId: z.string().uuid(), completionId: z.string().uuid() }),
  z.object({ kind: z.literal('delete_task'), taskId: z.string().uuid() }),
  z.object({ kind: z.literal('patch_task'), taskId: z.string().uuid(), previous: z.record(z.unknown()) }),
  z.object({ kind: z.literal('pause_habit'), habitId: z.string().uuid() }),
  z.object({ kind: z.literal('patch_habit'), habitId: z.string().uuid(), previous: z.record(z.unknown()) }),
]);
export type ChatUndoHint = z.infer<typeof chatUndoHintSchema>;

export const chatContextSchema = z.object({
  section: z.string().trim().min(1).max(32),
  listId: z.string().trim().min(1).max(64).nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  habitId: z.string().uuid().nullable().optional(),
  inboxId: z.string().uuid().nullable().optional(),
  outcomeId: z.string().uuid().nullable().optional(),
  visibleTaskIds: z.array(z.string().uuid()).max(20),
  visibleTruncated: z.boolean(),
});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const postChatMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  context: chatContextSchema,
});
export type PostChatMessageInput = z.infer<typeof postChatMessageSchema>;

export const chatUndoBodySchema = z.object({
  hintId: z.string().uuid(),
});

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName: string | null;
  toolPayload: unknown;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ChatSession {
  enabled: boolean;
  conversation: ChatConversation | null;
  messages: ChatMessage[];
}

export interface ChatToolCard {
  tool: string;
  status: 'ok' | 'preview' | 'needs_input' | 'error';
  summary: string;
  previewId?: string;
  undo?: { hintId: string };
  invalidate?: ChatInvalidateTag[];
  question?: string;
}
