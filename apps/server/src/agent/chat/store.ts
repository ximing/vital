import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ChatConversation, ChatMessage, ChatUndoHint } from '@vital/dto';
import { getDb } from '../../db/index.js';
import { agentChatConversations, agentChatMessages, agentChatPreviews, users } from '../../db/schema.js';
import { isUniqueViolation } from '../../db/pg.js';
import { AppError } from '../../errors.js';
import { reserveChatTurn } from './budget.js';
import { PREVIEW_TTL_MS } from './types.js';

const MAX_PAYLOAD = 32_000;

export function clipPayload(payload: unknown): unknown {
  try {
    if (JSON.stringify(payload).length <= MAX_PAYLOAD) return payload;
  } catch {
    return { summary: '结果无法保存' };
  }
  if (payload && typeof payload === 'object') {
    const copy = { ...(payload as Record<string, unknown>) };
    delete copy.data;
    delete copy.previous;
    return copy;
  }
  return { summary: '结果过长，已省略' };
}

function toMessage(row: typeof agentChatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage['role'],
    text: row.text,
    toolName: row.toolName,
    toolPayload: row.toolPayload,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getActiveConversation(userId: string): Promise<ChatConversation | null> {
  const [row] = await getDb()
    .select()
    .from(agentChatConversations)
    .where(and(eq(agentChatConversations.userId, userId), eq(agentChatConversations.status, 'active')))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    status: 'active',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOwnedChatMessage(userId: string, id: string) {
  const [row] = await getDb()
    .select()
    .from(agentChatMessages)
    .where(and(eq(agentChatMessages.id, id), eq(agentChatMessages.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function listChatMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
  const rows = await getDb()
    .select()
    .from(agentChatMessages)
    .where(and(eq(agentChatMessages.userId, userId), eq(agentChatMessages.conversationId, conversationId)))
    .orderBy(asc(agentChatMessages.createdAt), asc(agentChatMessages.id));
  return rows.map(toMessage);
}

async function insertConversation(tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0], userId: string, now: Date): Promise<string> {
  const id = randomUUID();
  await tx.insert(agentChatConversations).values({
    id,
    userId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Insert the user row and consume one daily turn. Returns the active conversation id. */
export async function beginUserTurn(userId: string, text: string, now = new Date()): Promise<{ conversationId: string; messageId: string; timezone: string }> {
  return getDb().transaction(async (tx) => {
    const timezone = await reserveChatTurn(tx, userId, now);
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    let conversationId: string;
    const [active] = await tx
      .select({ id: agentChatConversations.id })
      .from(agentChatConversations)
      .where(and(eq(agentChatConversations.userId, userId), eq(agentChatConversations.status, 'active')))
      .limit(1);
    if (active) {
      conversationId = active.id;
    } else {
      await tx.execute(sql`SAVEPOINT chat_conv`);
      try {
        conversationId = await insertConversation(tx, userId, now);
        await tx.execute(sql`RELEASE SAVEPOINT chat_conv`);
      } catch (err) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT chat_conv`);
        if (!isUniqueViolation(err)) throw err;
        const [again] = await tx
          .select({ id: agentChatConversations.id })
          .from(agentChatConversations)
          .where(and(eq(agentChatConversations.userId, userId), eq(agentChatConversations.status, 'active')))
          .limit(1);
        if (!again) throw err;
        conversationId = again.id;
      }
    }
    const messageId = randomUUID();
    await tx.insert(agentChatMessages).values({
      id: messageId,
      userId,
      conversationId,
      role: 'user',
      text,
      createdAt: now,
    });
    await tx
      .update(agentChatConversations)
      .set({ updatedAt: now })
      .where(eq(agentChatConversations.id, conversationId));
    return { conversationId, messageId, timezone };
  });
}

export async function insertChatMessage(input: {
  userId: string;
  conversationId: string;
  role: 'assistant' | 'tool';
  text: string;
  toolName?: string | null;
  toolPayload?: unknown;
}): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await getDb().insert(agentChatMessages).values({
    id,
    userId: input.userId,
    conversationId: input.conversationId,
    role: input.role,
    text: input.text,
    toolName: input.toolName ?? null,
    toolPayload: input.toolPayload === undefined ? null : clipPayload(input.toolPayload),
    createdAt: now,
  });
  return id;
}

export async function resetConversation(userId: string): Promise<ChatConversation> {
  const now = new Date();
  const id = await getDb().transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw AppError.of(401, 'INVALID_TOKEN');
    await tx
      .update(agentChatConversations)
      .set({ status: 'archived', updatedAt: now })
      .where(and(eq(agentChatConversations.userId, userId), eq(agentChatConversations.status, 'active')));
    return insertConversation(tx, userId, now);
  });
  return { id, status: 'active', createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export async function insertPreview(input: {
  userId: string;
  conversationId: string;
  toolName: string;
  args: unknown;
  summary: string;
}): Promise<{ id: string; expiresAt: string }> {
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
  await getDb().insert(agentChatPreviews).values({
    id,
    userId: input.userId,
    conversationId: input.conversationId,
    toolName: input.toolName,
    args: input.args,
    summary: input.summary,
    expiresAt,
    status: 'open',
    createdAt: now,
  });
  return { id, expiresAt: expiresAt.toISOString() };
}

export async function takePreview(userId: string, id: string, now = new Date()) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(agentChatPreviews)
      .where(and(eq(agentChatPreviews.id, id), eq(agentChatPreviews.userId, userId)))
      .for('update');
    if (!row || row.status !== 'open' || row.expiresAt <= now) {
      if (row && row.status === 'open' && row.expiresAt <= now) {
        await tx.update(agentChatPreviews).set({ status: 'expired' }).where(eq(agentChatPreviews.id, id));
      }
      return null;
    }
    await tx.update(agentChatPreviews).set({ status: 'applied' }).where(eq(agentChatPreviews.id, id));
    return row;
  });
}

export async function cancelPreview(userId: string, id: string): Promise<void> {
  const now = new Date();
  const [row] = await getDb()
    .select()
    .from(agentChatPreviews)
    .where(and(eq(agentChatPreviews.id, id), eq(agentChatPreviews.userId, userId)))
    .limit(1);
  if (!row || row.status !== 'open') throw AppError.of(409, 'CHAT_PREVIEW_CLOSED');
  const status = row.expiresAt <= now ? 'expired' : 'cancelled';
  await getDb()
    .update(agentChatPreviews)
    .set({ status })
    .where(and(eq(agentChatPreviews.id, id), eq(agentChatPreviews.status, 'open')));
  if (status === 'expired') throw AppError.of(409, 'CHAT_PREVIEW_CLOSED');
}

export function isBareUndo(text: string): boolean {
  const trimmed = text.trim().replace(/。$/, '');
  return trimmed === '撤销';
}

/** Undo hints on the assistant turn that precedes this user message. */
export async function latestUndoHints(userId: string, conversationId: string, userMessageId: string): Promise<{ hintId: string; hint: ChatUndoHint }[]> {
  const rows = await listChatMessages(userId, conversationId);
  const index = rows.findIndex((row) => row.id === userMessageId);
  const prior = index >= 0 ? rows.slice(0, index) : rows;
  const hints: { hintId: string; hint: ChatUndoHint }[] = [];
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const row = prior[i];
    if (!row) break;
    if (row.role === 'user') break;
    const payload = row.toolPayload;
    if (!payload || typeof payload !== 'object' || !('undo' in payload)) continue;
    const undo = (payload as { undo?: ChatUndoHint }).undo;
    if (!undo) continue;
    hints.push({ hintId: row.id, hint: undo });
  }
  return hints;
}
