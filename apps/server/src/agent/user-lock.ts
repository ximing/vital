import { eq } from 'drizzle-orm';
import { users } from '../db/schema/users.js';
import type { Database } from '../db/index.js';

/** First lock in Agent domain transactions. Never held during model inference.
 * NO KEY UPDATE serializes user writes without blocking FK bookkeeping inserts.
 */
export async function lockAgentUser(tx: Pick<Database, 'select'>, userId: string): Promise<void> {
  const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
  if (!user) throw new Error('Agent user no longer exists');
}
