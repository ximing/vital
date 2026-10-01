import { sql } from 'drizzle-orm';
import { char, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const agentChatConversations = pgTable(
  'agent_chat_conversations',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_chat_conversations_status_check', sql`${t.status} IN ('active', 'archived')`),
    uniqueIndex('agent_chat_conversations_active_uidx').on(t.userId).where(sql`${t.status} = 'active'`),
  ],
);

export const agentChatMessages = pgTable(
  'agent_chat_messages',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    conversationId: char('conversation_id', { length: 36 }).notNull(),
    role: varchar('role', { length: 16 }).notNull(),
    text: text('text').notNull(),
    toolName: varchar('tool_name', { length: 64 }),
    toolPayload: jsonb('tool_payload'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_chat_messages_role_check', sql`${t.role} IN ('user', 'assistant', 'tool')`),
    index('idx_agent_chat_messages_conv').on(t.userId, t.conversationId, t.createdAt),
  ],
);

export const agentChatPreviews = pgTable(
  'agent_chat_previews',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    conversationId: char('conversation_id', { length: 36 }).notNull(),
    toolName: varchar('tool_name', { length: 64 }).notNull(),
    args: jsonb('args').notNull(),
    summary: text('summary').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_chat_previews_status_check', sql`${t.status} IN ('open', 'applied', 'cancelled', 'expired')`),
    index('idx_agent_chat_previews_user').on(t.userId, t.createdAt),
  ],
);

export const agentChatBudgets = pgTable(
  'agent_chat_budgets',
  {
    userId: char('user_id', { length: 36 }).notNull(),
    day: date('day').notNull(),
    turns: integer('turns').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export type AgentChatMessageRow = typeof agentChatMessages.$inferSelect;
export type AgentChatPreviewRow = typeof agentChatPreviews.$inferSelect;
