import { randomUUID } from 'node:crypto';
import type { getDb } from '../db/index.js';
import { agentEditEvents, type AgentEditFieldChange } from '../db/schema.js';

/** Summary values are capped — the event stream never stores whole rows. */
const SUMMARY_LIMIT = 120;

type EditDb = Pick<ReturnType<typeof getDb>, 'insert'>;

function summarize(value: string): string {
  return value.length > SUMMARY_LIMIT ? value.slice(0, SUMMARY_LIMIT) : value;
}

function instant(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

async function insertEvent(
  db: EditDb,
  userId: string,
  entityType: 'task' | 'outcome',
  entityId: string,
  fields: AgentEditFieldChange[],
): Promise<void> {
  if (fields.length === 0) return;
  await db.insert(agentEditEvents).values({
    id: randomUUID(),
    userId,
    entityType,
    entityId,
    fields,
  });
}

/** Task fields with learning value for the distiller. notesMd is deliberately excluded. */
export interface TaskEditSnapshot {
  title: string;
  dueAt: Date | null;
  priority: number;
  estimateMinutes: number | null;
  outcomeId: string | null;
}

/**
 * Record what a user changed on a task, as one event with per-field before/after
 * summaries. Only called from the user-facing update path (patchTask) — agent
 * writes go straight to the tables and never produce events.
 */
export async function recordTaskEdit(
  db: EditDb,
  userId: string,
  taskId: string,
  before: TaskEditSnapshot,
  after: Partial<TaskEditSnapshot>,
): Promise<void> {
  const fields: AgentEditFieldChange[] = [];
  if (after.title !== undefined && after.title !== before.title) {
    fields.push({ field: 'title', before: summarize(before.title), after: summarize(after.title) });
  }
  if (after.dueAt !== undefined && !sameInstant(after.dueAt, before.dueAt)) {
    fields.push({ field: 'dueAt', before: instant(before.dueAt), after: instant(after.dueAt) });
  }
  if (after.priority !== undefined && after.priority !== before.priority) {
    fields.push({ field: 'priority', before: before.priority, after: after.priority });
  }
  if (
    after.estimateMinutes !== undefined &&
    after.estimateMinutes !== before.estimateMinutes
  ) {
    fields.push({
      field: 'estimateMinutes',
      before: before.estimateMinutes,
      after: after.estimateMinutes,
    });
  }
  if (after.outcomeId !== undefined && after.outcomeId !== before.outcomeId) {
    fields.push({ field: 'outcomeId', before: before.outcomeId, after: after.outcomeId });
  }
  await insertEvent(db, userId, 'task', taskId, fields);
}

/** Thread renames are the one outcome edit worth distilling. */
export async function recordOutcomeRename(
  db: EditDb,
  userId: string,
  outcomeId: string,
  beforeName: string,
  afterName: string,
): Promise<void> {
  if (beforeName === afterName) return;
  await insertEvent(db, userId, 'outcome', outcomeId, [
    { field: 'name', before: summarize(beforeName), after: summarize(afterName) },
  ]);
}
