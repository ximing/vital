import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { AppError } from '../errors.js';
import { getInboxList } from '../lists/lists.service.js';
import { createTag, listTags } from '../tags/tags.service.js';
import { createTask, listTasks } from '../tasks/tasks.service.js';
import { SAMPLE_TAG, SAMPLE_TITLES } from './guard.js';

export { SAMPLE_TAG, SAMPLE_TITLES, assertDevelopmentSeed } from './guard.js';

async function sampleTagId(userId: string): Promise<string> {
  const existing = (await listTags(userId)).items.find(
    (tag) => tag.name.toLowerCase() === SAMPLE_TAG,
  );
  if (existing) return existing.id;
  try {
    return (await createTag(userId, { name: SAMPLE_TAG })).id;
  } catch (err) {
    if (err instanceof AppError && err.status === 409) {
      const again = (await listTags(userId)).items.find(
        (tag) => tag.name.toLowerCase() === SAMPLE_TAG,
      );
      if (again) return again.id;
    }
    throw err;
  }
}

export async function seedSampleTasks(userId: string): Promise<{ created: number; tagId: string }> {
  const tagId = await sampleTagId(userId);
  const inbox = await getInboxList(userId);
  const listed = await listTasks(userId, { listId: inbox.id, limit: 100 });
  const have = listed.items.filter((task) => task.tagIds.includes(tagId) && task.deletedAt === null);
  let created = 0;
  for (const title of SAMPLE_TITLES) {
    if (have.some((task) => task.title === title)) continue;
    await createTask(userId, { title, listId: inbox.id, tagIds: [tagId] });
    created += 1;
  }
  return { created, tagId };
}

export async function seedSampleTasksForEmail(
  email: string,
): Promise<{ created: number; tagId: string; userId: string }> {
  const normalized = email.trim().toLowerCase();
  const [user] = await getDb().select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!user) throw AppError.of(404, 'NOT_FOUND');
  const result = await seedSampleTasks(user.id);
  return { ...result, userId: user.id };
}
