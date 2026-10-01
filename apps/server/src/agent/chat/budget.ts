import { eq, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { getDb } from '../../db/index.js';
import { agentChatBudgets, users } from '../../db/schema.js';
import { AppError } from '../../errors.js';
import { CHAT_TURN_LIMIT } from './types.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Count one user message. Full budget throws; it does not touch the background ledger. */
export async function reserveChatTurn(tx: Tx, userId: string, now = new Date()): Promise<string> {
  const [user] = await tx
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw AppError.of(401, 'INVALID_TOKEN');
  const day = DateTime.fromJSDate(now).setZone(user.timezone).toISODate();
  if (!day) throw AppError.of(400, 'VALIDATION_ERROR');
  const rows = await tx
    .insert(agentChatBudgets)
    .values({ userId, day, turns: 1 })
    .onConflictDoUpdate({
      target: [agentChatBudgets.userId, agentChatBudgets.day],
      set: { turns: sql`${agentChatBudgets.turns} + 1` },
      setWhere: lt(agentChatBudgets.turns, CHAT_TURN_LIMIT),
    })
    .returning({ turns: agentChatBudgets.turns });
  if (!rows.length) throw AppError.of(429, 'CHAT_TURN_LIMIT');
  return user.timezone;
}
