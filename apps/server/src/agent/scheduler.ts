import { eq, gte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { tasks, users } from '../db/schema.js';
import { spawnDailyHabits } from '../habits/habits.service.js';
import { enqueueAgentJobOnce } from './jobs.js';

const ACTIVE_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * Slow scheduler tick (AGENT_SCHEDULER_INTERVAL_MS): for users with task
 * activity in the last 7 days —
 *  - upsert reflect.daily:{userId}:{yyyy-mm-dd} (user tz, idempotent)
 *  - spawn today's habit instances (rule layer, habit_key idempotent)
 *  - upsert memory.distill:{userId}:{iso-week} (weekly)
 */
export async function runAgentScheduler(now = new Date()): Promise<number> {
  if (!config.AGENT_ENABLED) return 0;
  const db = getDb();
  const since = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const rows = await db
    .selectDistinct({ userId: tasks.userId })
    .from(tasks)
    .where(gte(tasks.updatedAt, since))
    .limit(200);

  let scheduled = 0;
  for (const { userId } of rows) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) continue;
    const zoned = DateTime.fromJSDate(now).setZone(user.timezone);
    const day = zoned.toISODate() ?? now.toISOString().slice(0, 10);
    const week = zoned.toFormat("kkkk-'W'WW");
    await enqueueAgentJobOnce(db, {
      userId,
      jobType: 'reflect.daily',
      payload: { date: day },
      dedupKey: `reflect.daily:${userId}:${day}`,
      scheduledAt: now,
    });
    await enqueueAgentJobOnce(db, {
      userId,
      jobType: 'memory.distill',
      payload: { date: week },
      dedupKey: `memory.distill:${userId}:${week}`,
      scheduledAt: now,
    });
    await spawnDailyHabits(userId, user.timezone, now);
    scheduled += 1;
  }
  return scheduled;
}
