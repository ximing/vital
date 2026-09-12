import { randomUUID } from 'node:crypto';
import {
  llmReady,
  type CalendarQuery,
  type CalendarResponse,
  type CompleteTaskResponse,
  type CreateTaskFromTextInput,
  type CreateTaskInput,
  type ListTasksQuery,
  type PatchTaskInput,
  type ReorderTasksInput,
  type Task,
  type TaskCollection,
  type TaskCounts,
  type TaskDraftTrigger,
  type TaskStatus,
  type UncompleteTaskInput,
} from '@vital/dto';
import {
  and,
  asc,
  type Column,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getUserEntity } from '../auth/auth.service.js';
import { recordTaskEdit } from '../agent/edit-events.service.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import {
  inboxItems,
  agentActions,
  agentJobs,
  taskCompletions,
  tasks,
  taskTags,
  type NewTask,
  type TaskRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import {
  getInboxList,
  getOwnedListOr404,
  listIdAndDescendants,
  listLists,
  SORT_GAP,
} from '../lists/lists.service.js';
import { nextSortOrder } from './sort-order.js';
import { llmPublicOf } from '../llm/settings.service.js';
import {
  enqueueOutcomeRefresh,
  enqueueTaskDecompose,
  enqueueTaskDraft,
  hasPendingDecomposeAction,
} from '../agent/jobs.js';
import { markAgentSchedule } from '../agent/scheduling.js';
import { executionResult, skipExecution, withExecution } from '../agent/executions.service.js';
import { toAgentActionDto } from '../agent/actions.service.js';
import { spawnNextOnComplete } from '../habits/habits.service.js';
import { isDefer, needsDecomposition } from '../outcomes/rule-engine.js';
import { assertOwnedOutcomeId } from '../outcomes/shared.js';
import {
  buildCreateInputFromIntent,
  interpretTaskText,
  type ExtractedTask,
} from '../llm/parse-task.js';
import { syncTaskNotifications } from '../notifications/outbox.js';
import { indexTask, removeTaskIndex, trackTaskIndexJob } from '../retrieval/tasks.js';
import { assertOwnedTagIds, listTags } from '../tags/tags.service.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import {
  allDayLocalMidnight,
  expandFixedTask,
  expandTask,
  nextFixedOccurrenceAfter,
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  parseRrule,
  type RecurrenceTask,
} from './recurrence.js';
import {
  asPriority,
  asRecurrenceKind,
  asReminderMode,
  asReminderOffsetMinutes,
  toTaskDto,
} from './task-dto.js';

function toRecurrence(row: TaskRow): RecurrenceTask {
  return {
    id: row.id,
    listId: row.listId,
    title: row.title,
    timezone: row.timezone,
    isAllDay: row.isAllDay,
    dueAt: row.dueAt,
    startAt: row.startAt,
    recurrenceRrule: row.recurrenceRrule,
    recurrenceDtstart: row.recurrenceDtstart,
    status: row.status,
    priority: row.priority,
    pinned: row.pinned,
  };
}

function isRecurring(row: TaskRow): boolean {
  return row.recurrenceRrule !== null || asRecurrenceKind(row.recurrenceKind) !== null;
}

async function tagIdsByTask(taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const id of taskIds) map.set(id, []);
  if (taskIds.length === 0) return map;
  const rows = await getDb().select().from(taskTags).where(inArray(taskTags.taskId, taskIds));
  for (const row of rows) {
    const current = map.get(row.taskId);
    if (current) current.push(row.tagId);
    else map.set(row.taskId, [row.tagId]);
  }
  return map;
}

async function dtoOf(row: TaskRow): Promise<Task> {
  const tags = await tagIdsByTask([row.id]);
  return toTaskDto(row, tags.get(row.id) ?? []);
}

/**
 * Fire-and-forget retrieval indexing. PG stays the source of truth; index
 * failures are logged, never thrown, and drift is healed by index.sync.
 */
function fireIndexTask(row: TaskRow): void {
  trackTaskIndexJob(
    indexTask(row).catch((err: unknown) => {
      console.error('[retrieval] indexTask failed', err);
    }),
  );
}

function fireRemoveTaskIndex(taskId: string): void {
  trackTaskIndexJob(
    removeTaskIndex(taskId).catch((err: unknown) => {
      console.error('[retrieval] removeTaskIndex failed', err);
    }),
  );
}

async function replaceTags(
  taskId: string,
  tagIds: string[],
  db: Pick<ReturnType<typeof getDb>, 'delete' | 'insert'> = getDb(),
): Promise<void> {
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  await db.insert(taskTags).values(unique.map((tagId) => ({ taskId, tagId })));
}

export async function getOwnedTaskOr404(
  userId: string,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<TaskRow> {
  const [row] = await getDb().select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'TASK_NOT_FOUND');
  if (!opts.includeDeleted && row.deletedAt) throw AppError.of(404, 'TASK_NOT_FOUND');
  return row;
}

function parseInstant(isoStr: string, allDay: boolean, zone: string): Date {
  if (allDay) return allDayLocalMidnight(isoStr, zone);
  const dt = DateTime.fromISO(isoStr);
  if (!dt.isValid) throw AppError.of(400, 'VALIDATION_ERROR');
  return dt.toJSDate();
}

function snapExisting(d: Date | null, allDay: boolean, zone: string): Date | null {
  if (d === null) return null;
  if (!allDay) return d;
  return DateTime.fromJSDate(d, { zone }).startOf('day').toJSDate();
}

function shiftBy(d: Date | null, deltaMs: number): Date | null {
  if (d === null) return null;
  return new Date(d.getTime() + deltaMs);
}

function localDateSql(col: Column, tz: string): SQL {
  return sql`(timezone(${tz}, ${col}))::date`;
}

function todaySql(tz: string): SQL {
  return sql`(timezone(${tz}, now()))::date`;
}

function openCond(userId: string): SQL {
  return and(
    eq(tasks.userId, userId),
    isNull(tasks.deletedAt),
    inArray(tasks.status, ['todo', 'doing']),
  ) as SQL;
}

async function smartFilter(userId: string, listId: string, tz: string): Promise<SQL> {
  const today = todaySql(tz);
  switch (listId) {
    case 'smart:inbox': {
      const inbox = await getInboxList(userId);
      return and(openCond(userId), eq(tasks.listId, inbox.id)) as SQL;
    }
    case 'smart:today':
      return and(
        openCond(userId),
        or(
          and(isNotNull(tasks.dueAt), sql`${localDateSql(tasks.dueAt, tz)} <= ${today}`),
          and(isNotNull(tasks.startAt), sql`${localDateSql(tasks.startAt, tz)} = ${today}`),
        ),
      ) as SQL;
    case 'smart:upcoming':
      return and(
        openCond(userId),
        or(
          and(
            isNotNull(tasks.dueAt),
            sql`${localDateSql(tasks.dueAt, tz)} >= ${today}`,
            sql`${localDateSql(tasks.dueAt, tz)} <= (${today} + interval '7 days')`,
          ),
          and(
            isNotNull(tasks.startAt),
            sql`${localDateSql(tasks.startAt, tz)} >= ${today}`,
            sql`${localDateSql(tasks.startAt, tz)} <= (${today} + interval '7 days')`,
          ),
        ),
      ) as SQL;
    case 'smart:someday':
      return and(openCond(userId), isNull(tasks.dueAt), isNull(tasks.startAt)) as SQL;
    case 'smart:done':
      return and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        eq(tasks.status, 'done'),
        isNotNull(tasks.completedAt),
        sql`${tasks.completedAt} >= now() - interval '30 days'`,
      ) as SQL;
    default: {
      const ids = await listIdAndDescendants(userId, listId);
      return and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        inArray(tasks.listId, ids),
      ) as SQL;
    }
  }
}

export async function listTasks(userId: string, query: ListTasksQuery): Promise<TaskCollection> {
  const user = await getUserEntity(userId);
  const where = await smartFilter(userId, query.listId, user.timezone);
  const limit = query.limit;
  const order =
    query.listId === 'smart:done'
      ? [desc(tasks.completedAt), desc(tasks.id)]
      : [asc(tasks.sortOrder), asc(tasks.id)];

  let cond: SQL = where;
  if (query.cursor !== undefined) {
    const cur = decodeCursor(query.cursor);
    if (query.listId === 'smart:done') {
      const t = new Date(cur.t);
      cond = and(
        where,
        or(lt(tasks.completedAt, t), and(eq(tasks.completedAt, t), lt(tasks.id, cur.id))),
      ) as SQL;
    } else {
      const sort = Number(cur.t);
      cond = and(
        where,
        or(
          sql`${tasks.sortOrder} > ${sort}`,
          and(eq(tasks.sortOrder, sort), sql`${tasks.id} > ${cur.id}`),
        ),
      ) as SQL;
    }
  }

  const rows = await getDb()
    .select()
    .from(tasks)
    .where(cond)
    .orderBy(...order)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const tags = await tagIdsByTask(page.map((r) => r.id));
  const items = page.map((r) => toTaskDto(r, tags.get(r.id) ?? []));
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = page[page.length - 1];
    if (last) {
      const t =
        query.listId === 'smart:done'
          ? (last.completedAt ?? last.createdAt).toISOString()
          : String(last.sortOrder);
      nextCursor = encodeCursor(t, last.id);
    }
  }
  return { items, nextCursor };
}

export async function getTask(userId: string, id: string): Promise<Task> {
  return dtoOf(await getOwnedTaskOr404(userId, id));
}

const COUNTED_SMART_IDS = [
  'smart:inbox',
  'smart:today',
  'smart:upcoming',
  'smart:someday',
] as const;

export async function taskCounts(userId: string): Promise<TaskCounts> {
  const user = await getUserEntity(userId);
  const counts: Record<string, number> = {};
  const perList = await getDb()
    .select({ listId: tasks.listId, n: count() })
    .from(tasks)
    .where(openCond(userId))
    .groupBy(tasks.listId);
  for (const row of perList) counts[row.listId] = row.n;
  for (const id of COUNTED_SMART_IDS) {
    const where = await smartFilter(userId, id, user.timezone);
    const [row] = await getDb().select({ n: count() }).from(tasks).where(where);
    counts[id] = row?.n ?? 0;
  }
  return { counts };
}

export async function createTask(userId: string, input: CreateTaskInput): Promise<Task> {
  const user = await getUserEntity(userId);
  let listId = input.listId;
  let parentId: string | null = input.parentId ?? null;
  if (parentId) {
    const parent = await getOwnedTaskOr404(userId, parentId);
    if (parent.parentId) throw AppError.of(400, 'VALIDATION_ERROR');
    if (input.listId !== parent.listId) throw AppError.of(400, 'VALIDATION_ERROR');
    listId = parent.listId;
    parentId = parent.id;
  } else {
    await getOwnedListOr404(userId, listId);
  }
  if (parentId && input.pinned) throw AppError.of(400, 'VALIDATION_ERROR');
  if (input.tagIds !== undefined) await assertOwnedTagIds(userId, input.tagIds);
  if (input.outcomeId) await assertOwnedOutcomeId(userId, input.outcomeId);

  const zone = input.timezone ?? user.timezone;
  const isAllDay = input.isAllDay ?? false;
  const dueAt =
    input.dueAt === undefined || input.dueAt === null
      ? null
      : parseInstant(input.dueAt, isAllDay, zone);
  const startAt =
    input.startAt === undefined || input.startAt === null
      ? null
      : parseInstant(input.startAt, isAllDay, zone);

  const reminderMode = input.reminderMode ?? null;
  const reminderOffsetMinutes =
    reminderMode === 'offset' ? (input.reminderOffsetMinutes ?? null) : null;
  const reminderAt =
    reminderMode === 'custom' && input.reminderAt !== null && input.reminderAt !== undefined
      ? parseInstant(input.reminderAt, false, zone)
      : null;
  if ((reminderMode === 'due' || reminderMode === 'offset') && dueAt === null) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (
    (reminderMode === 'offset' && reminderOffsetMinutes === null) ||
    (reminderMode === 'custom' && reminderAt === null)
  ) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  let recurrence: string | null = null;
  let recurrenceDtstart: Date | null = null;
  if (input.recurrence !== undefined && input.recurrence !== null) {
    if (dueAt === null) throw AppError.of(400, 'RRULE_DUE_REQUIRED');
    parseRrule(input.recurrence);
    recurrence = input.recurrence;
    recurrenceDtstart = dueAt;
  }
  const recurrenceKind = input.recurrenceKind ?? null;
  if (recurrenceKind !== null && (dueAt === null || input.recurrence !== undefined)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  const now = new Date();
  const row: NewTask = {
    id: randomUUID(),
    userId,
    listId,
    parentId,
    outcomeId: input.outcomeId ?? null,
    estimateMinutes: input.estimateMinutes ?? null,
    title: input.title,
    notesMd: input.notes ?? '',
    status: input.status ?? 'todo',
    priority: input.priority ?? 3,
    pinned: input.pinned ?? false,
    dueAt,
    startAt,
    reminderMode,
    reminderOffsetMinutes,
    reminderAt,
    isAllDay,
    timezone: zone,
    recurrenceRrule: recurrence,
    recurrenceKind,
    recurrenceDtstart,
    completedAt: null,
    sortOrder: await nextSortOrder(listId, parentId),
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().transaction(async (tx) => {
    await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
    await tx.insert(tasks).values(row);
    if (input.tagIds !== undefined) await replaceTags(row.id, input.tagIds, tx);
    await syncTaskNotifications(
      {
        id: row.id,
        userId: row.userId,
        listId: row.listId,
        title: row.title,
        status: row.status ?? 'todo',
        dueAt: row.dueAt ?? null,
        reminderMode: row.reminderMode ?? null,
        reminderOffsetMinutes: row.reminderOffsetMinutes ?? null,
        reminderAt: row.reminderAt ?? null,
        isAllDay: row.isAllDay ?? false,
        timezone: row.timezone,
        deletedAt: row.deletedAt ?? null,
      },
      user,
      now,
      tx,
    );
    if (row.outcomeId) await enqueueOutcomeRefresh(tx, userId, row.outcomeId, now);
  });
  const [created] = await getDb().select().from(tasks).where(eq(tasks.id, row.id)).limit(1);
  if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
  fireIndexTask(created);
  return dtoOf(created);
}

export async function createTaskFromText(
  userId: string,
  input: CreateTaskFromTextInput,
): Promise<Task> {
  return withExecution({ userId, capability: 'task.parse' }, async () => {
    const user = await getUserEntity(userId);
    const inbox = await getInboxList(userId);
    if (input.listId !== undefined) await getOwnedListOr404(userId, input.listId);
    const lists = await listLists(userId);
    const tags = await listTags(userId);
    const zone = input.timezone ?? user.timezone;
    const now = new Date();
    let extracted: ExtractedTask | null = null;
    if (llmReady(llmPublicOf(user), 'task.parse')) {
      extracted = await interpretTaskText({
        text: input.text,
        user,
        timezone: zone,
        now,
        lists: lists.items,
        tags: tags.items,
        ...(input.smartListId !== undefined ? { smartListId: input.smartListId } : {}),
      });
    }
    const payload = buildCreateInputFromIntent(input, extracted, {
      lists: lists.items,
      tags: tags.items,
      inboxId: inbox.id,
      now,
    });
    const task = await createTask(userId, payload);
    if (extracted === null) skipExecution('NO_MODEL');
    executionResult({ targetType: 'task', targetId: task.id, resultSummary: task.title });
    return task;
  });
}

export async function patchTask(userId: string, id: string, input: PatchTaskInput): Promise<Task> {
  const task = await getOwnedTaskOr404(userId, id);
  if (input.pinned && task.parentId) throw AppError.of(400, 'VALIDATION_ERROR');
  if (input.delegable === true && (task.status === 'done' || task.status === 'canceled')) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (input.tagIds !== undefined) await assertOwnedTagIds(userId, input.tagIds);
  if (input.outcomeId) await assertOwnedOutcomeId(userId, input.outcomeId);
  if (input.listId !== undefined && task.parentId && input.listId !== task.listId) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (input.listId !== undefined && input.listId !== task.listId) {
    await getOwnedListOr404(userId, input.listId);
  }

  const zone = input.timezone ?? task.timezone;
  const isAllDay = input.isAllDay ?? task.isAllDay;

  let dueAt = task.dueAt;
  let startAt = task.startAt;
  let reminderMode = asReminderMode(task.reminderMode);
  let reminderOffsetMinutes = asReminderOffsetMinutes(task.reminderOffsetMinutes);
  let reminderAt = task.reminderAt;
  if (input.dueAt !== undefined) {
    dueAt = input.dueAt === null ? null : parseInstant(input.dueAt, isAllDay, zone);
  } else if (input.isAllDay !== undefined || input.timezone !== undefined) {
    dueAt = snapExisting(dueAt, isAllDay, zone);
  }
  if (input.startAt !== undefined) {
    startAt = input.startAt === null ? null : parseInstant(input.startAt, isAllDay, zone);
  } else if (input.isAllDay !== undefined || input.timezone !== undefined) {
    startAt = snapExisting(startAt, isAllDay, zone);
  }

  if (input.reminderMode !== undefined) {
    reminderMode = input.reminderMode;
    if (reminderMode === null || reminderMode === 'none' || reminderMode === 'due') {
      reminderOffsetMinutes = null;
      reminderAt = null;
    }
    if (reminderMode === 'offset') {
      reminderOffsetMinutes = input.reminderOffsetMinutes ?? null;
      reminderAt = null;
    }
    if (reminderMode === 'custom') {
      reminderOffsetMinutes = null;
      reminderAt =
        input.reminderAt === null || input.reminderAt === undefined
          ? null
          : parseInstant(input.reminderAt, false, zone);
    }
  } else if (input.reminderOffsetMinutes !== undefined || input.reminderAt !== undefined) {
    if (reminderMode === 'offset' && input.reminderOffsetMinutes !== undefined) {
      reminderOffsetMinutes = input.reminderOffsetMinutes;
    } else if (reminderMode === 'custom' && input.reminderAt !== undefined) {
      reminderAt = input.reminderAt === null ? null : parseInstant(input.reminderAt, false, zone);
    } else {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
  }
  if ((reminderMode === 'due' || reminderMode === 'offset') && dueAt === null) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (
    (reminderMode === 'offset' && reminderOffsetMinutes === null) ||
    (reminderMode === 'custom' && reminderAt === null)
  ) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  let recurrence = task.recurrenceRrule;
  let recurrenceDtstart = task.recurrenceDtstart;
  let recurrenceKind = asRecurrenceKind(task.recurrenceKind);
  if (input.recurrence !== undefined && input.recurrenceKind !== undefined) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (input.recurrence !== undefined) {
    if (input.recurrence === null) {
      recurrence = null;
      recurrenceDtstart = null;
    } else {
      if (dueAt === null) throw AppError.of(400, 'RRULE_DUE_REQUIRED');
      parseRrule(input.recurrence);
      recurrence = input.recurrence;
      if (task.recurrenceDtstart === null) recurrenceDtstart = dueAt;
    }
  } else if (recurrence && dueAt === null) {
    throw AppError.of(400, 'RRULE_DUE_REQUIRED');
  }
  if (input.recurrenceKind !== undefined) {
    recurrenceKind = input.recurrenceKind;
    recurrence = null;
    recurrenceDtstart = recurrenceKind === null ? null : dueAt;
  }
  if (recurrenceKind !== null && dueAt === null) throw AppError.of(400, 'VALIDATION_ERROR');

  const oldDue = task.dueAt;
  if (input.dueAt !== undefined && recurrence && dueAt) {
    const snapped = nextOccurrenceOnOrAfter(
      {
        ...toRecurrence(task),
        recurrenceRrule: recurrence,
        recurrenceDtstart,
        isAllDay,
        timezone: zone,
        dueAt,
      },
      dueAt,
    );
    if (snapped === null) throw AppError.of(400, 'RRULE_INVALID');
    if (oldDue) {
      const delta = snapped.getTime() - oldDue.getTime();
      startAt = shiftBy(startAt, delta);
      reminderAt = shiftBy(reminderAt, delta);
    }
    dueAt = snapped;
  }

  const now = new Date();
  const deferred = isDefer(oldDue, input.dueAt === undefined ? undefined : dueAt, now);
  const patch: Partial<TaskRow> = {
    updatedAt: now,
    timezone: zone,
    isAllDay,
    dueAt,
    startAt,
    reminderMode,
    reminderOffsetMinutes,
    reminderAt,
    recurrenceRrule: recurrence,
    recurrenceKind,
    recurrenceDtstart,
    ...(deferred ? { deferCount: task.deferCount + 1 } : {}),
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notesMd = input.notes ?? '';
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.pinned !== undefined) patch.pinned = input.pinned;
  if (input.listId !== undefined) patch.listId = input.listId;
  if (input.outcomeId !== undefined) patch.outcomeId = input.outcomeId;
  if (input.estimateMinutes !== undefined) patch.estimateMinutes = input.estimateMinutes;
  if (input.delegable !== undefined) patch.delegable = input.delegable;

  const user = await getUserEntity(userId);
  await getDb().transaction(async (tx) => {
    await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
    // User edit events feed memory.distill; agent writes bypass this call.
    await recordTaskEdit(
      tx,
      userId,
      task.id,
      {
        title: task.title,
        dueAt: task.dueAt,
        priority: task.priority,
        estimateMinutes: task.estimateMinutes,
        outcomeId: task.outcomeId,
      },
      {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        // The computed instant also moves on isAllDay/timezone snaps — still a due change.
        dueAt,
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.estimateMinutes !== undefined
          ? { estimateMinutes: patch.estimateMinutes }
          : {}),
        ...(patch.outcomeId !== undefined ? { outcomeId: patch.outcomeId } : {}),
      },
    );
    await tx.update(tasks).set(patch).where(eq(tasks.id, task.id));
    if (input.listId !== undefined && input.listId !== task.listId && !task.parentId) {
      await tx
        .update(tasks)
        .set({ listId: input.listId, updatedAt: now })
        .where(and(eq(tasks.parentId, task.id), eq(tasks.userId, userId)));
    }
    if (input.tagIds !== undefined) await replaceTags(task.id, input.tagIds, tx);
    await syncTaskNotifications(
      {
        id: task.id,
        userId: task.userId,
        listId: patch.listId ?? task.listId,
        title: patch.title ?? task.title,
        status: patch.status ?? task.status,
        dueAt: patch.dueAt !== undefined ? patch.dueAt : task.dueAt,
        reminderMode: patch.reminderMode ?? task.reminderMode,
        reminderOffsetMinutes: patch.reminderOffsetMinutes ?? task.reminderOffsetMinutes,
        reminderAt: patch.reminderAt !== undefined ? patch.reminderAt : task.reminderAt,
        isAllDay: patch.isAllDay ?? task.isAllDay,
        timezone: patch.timezone ?? task.timezone,
        deletedAt: task.deletedAt,
      },
      user,
      now,
      tx,
    );
    const nextOutcomeId = input.outcomeId !== undefined ? input.outcomeId : task.outcomeId;
    if (nextOutcomeId) await enqueueOutcomeRefresh(tx, userId, nextOutcomeId, now);
    if (input.outcomeId !== undefined && task.outcomeId && task.outcomeId !== nextOutcomeId) {
      await enqueueOutcomeRefresh(tx, userId, task.outcomeId, now);
    }
    if (
      deferred &&
      needsDecomposition(task.deferCount + 1) &&
      !(await hasPendingDecomposeAction(tx, task.id, userId))
    ) {
      await enqueueTaskDecompose(tx, userId, task.id, now);
    }
  });
  const updated = await getOwnedTaskOr404(userId, id);
  fireIndexTask(updated);
  return dtoOf(updated);
}

function assertDraftable(task: TaskRow): void {
  if (!task.delegable || task.status === 'done' || task.status === 'canceled') {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
}

async function pendingDraftAction(userId: string, taskId: string) {
  const [pending] = await getDb()
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, userId),
        eq(agentActions.targetType, 'task'),
        eq(agentActions.targetId, taskId),
        eq(agentActions.actionType, 'task.draft'),
        eq(agentActions.feedback, 'pending'),
      ),
    )
    .limit(1);
  return pending ?? null;
}

/**
 * Read-only view of the draft job for a delegable task. Does not enqueue.
 * Used by the web detail pane to restore "起草中" / failure after remount.
 */
export async function getTaskDraft(userId: string, id: string): Promise<TaskDraftTrigger> {
  const task = await getOwnedTaskOr404(userId, id);
  assertDraftable(task);
  const pending = await pendingDraftAction(userId, task.id);
  if (pending) return { status: 'pending', action: toAgentActionDto(pending) };

  const [job] = await getDb()
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.userId, userId), eq(agentJobs.dedupKey, `task.draft:${task.id}`)))
    .limit(1);
  if (!job) return { status: 'idle', action: null };
  if (job.status === 'pending' || job.status === 'running') return { status: 'queued', action: null };
  if (job.status === 'failed' || job.lastError) return { status: 'failed', action: null };

  const [anyAction] = await getDb()
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, userId),
        eq(agentActions.targetType, 'task'),
        eq(agentActions.targetId, task.id),
        eq(agentActions.actionType, 'task.draft'),
      ),
    )
    .limit(1);
  if (!anyAction) return { status: 'failed', action: null };
  return { status: 'idle', action: null };
}

/**
 * Manual trigger: the user asks the agent to draft an execution plan for a
 * delegable task. Idempotent — an existing pending draft is returned as-is;
 * otherwise a task.draft job is (re)armed and runs in the worker.
 */
export async function requestTaskDraft(userId: string, id: string): Promise<TaskDraftTrigger> {
  const task = await getOwnedTaskOr404(userId, id);
  assertDraftable(task);
  const pending = await pendingDraftAction(userId, task.id);
  if (pending) return { status: 'pending', action: toAgentActionDto(pending) };
  await enqueueTaskDraft(getDb(), userId, task.id, new Date());
  return { status: 'queued', action: null };
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const task = await getOwnedTaskOr404(userId, id);
  const user = await getUserEntity(userId);
  const now = new Date();
  const removedIds: string[] = [task.id];
  await getDb().transaction(async (tx) => {
    await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
    if (task.parentId) {
      await tx.update(tasks).set({ deletedAt: now, updatedAt: now }).where(eq(tasks.id, task.id));
      await syncTaskNotifications({ ...task, deletedAt: now }, user, now, tx);
      if (task.outcomeId) await enqueueOutcomeRefresh(tx, userId, task.outcomeId, now);
      return;
    }
    const children = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentId, task.id), eq(tasks.userId, userId)));
    removedIds.push(...children.map((child) => child.id));
    await tx
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(tasks.userId, userId), or(eq(tasks.id, task.id), eq(tasks.parentId, task.id))));
    await syncTaskNotifications({ ...task, deletedAt: now }, user, now, tx);
    for (const child of children) {
      await syncTaskNotifications({ ...child, deletedAt: now }, user, now, tx);
    }
    if (task.outcomeId) await enqueueOutcomeRefresh(tx, userId, task.outcomeId, now);
  });
  for (const removedId of removedIds) fireRemoveTaskIndex(removedId);
}

export async function restoreTask(userId: string, id: string): Promise<Task> {
  const task = await getOwnedTaskOr404(userId, id, { includeDeleted: true });
  const user = await getUserEntity(userId);
  const now = new Date();
  // Rows whose index entries were dropped on delete and must be re-indexed.
  // Only deletedAt changes on restore, so the pre-update rows carry the
  // correct payload fields (title/notes/status/...).
  const restored: TaskRow[] = [task];
  await getDb().transaction(async (tx) => {
    await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
    if (task.parentId) {
      await tx.update(tasks).set({ deletedAt: null, updatedAt: now }).where(eq(tasks.id, task.id));
      await syncTaskNotifications({ ...task, deletedAt: null }, user, now, tx);
      if (task.outcomeId) await enqueueOutcomeRefresh(tx, userId, task.outcomeId, now);
      return;
    }
    const children = await tx
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.parentId, task.id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt)),
      );
    restored.push(...children);
    await tx
      .update(tasks)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(
          eq(tasks.userId, userId),
          or(eq(tasks.id, task.id), and(eq(tasks.parentId, task.id), isNotNull(tasks.deletedAt))),
        ),
      );
    await syncTaskNotifications({ ...task, deletedAt: null }, user, now, tx);
    for (const child of children) {
      await syncTaskNotifications({ ...child, deletedAt: null }, user, now, tx);
    }
    if (task.outcomeId) await enqueueOutcomeRefresh(tx, userId, task.outcomeId, now);
  });
  for (const row of restored) fireIndexTask(row);
  return dtoOf(await getOwnedTaskOr404(userId, id));
}

export async function completeTask(userId: string, id: string): Promise<CompleteTaskResponse> {
  const task = await getOwnedTaskOr404(userId, id);
  if (task.status === 'canceled') throw AppError.of(400, 'VALIDATION_ERROR');
  if (task.status === 'done' && !isRecurring(task)) throw AppError.of(409, 'VALIDATION_ERROR');
  const user = await getUserEntity(userId);

  const now = new Date();
  const dueWasNull = task.dueAt === null;
  const occurrenceAt = task.dueAt ?? now;
  const completionId = randomUUID();

  let nextDue = task.dueAt;
  let nextStart = task.startAt;
  let nextReminderAt = task.reminderAt;
  let nextStatus: TaskStatus = 'done';
  let completedAt: Date | null = now;

  if (task.recurrenceRrule && task.dueAt) {
    const nxt = nextOccurrenceAfter(toRecurrence(task), task.dueAt);
    if (nxt) {
      const delta = nxt.getTime() - task.dueAt.getTime();
      nextDue = nxt;
      nextStart = shiftBy(task.startAt, delta);
      nextReminderAt = shiftBy(task.reminderAt, delta);
      nextStatus = 'todo';
      completedAt = null;
    }
  }
  const recurrenceKind = asRecurrenceKind(task.recurrenceKind);
  if (recurrenceKind && task.dueAt) {
    const nxt = await nextFixedOccurrenceAfter(
      {
        dueAt: task.dueAt,
        timezone: task.timezone,
        isAllDay: task.isAllDay,
        recurrenceKind,
      },
      task.dueAt,
    );
    if (nxt) {
      const delta = nxt.getTime() - task.dueAt.getTime();
      nextDue = nxt;
      nextStart = shiftBy(task.startAt, delta);
      nextReminderAt = shiftBy(task.reminderAt, delta);
      nextStatus = 'todo';
      completedAt = null;
    }
  }

  try {
    await getDb().transaction(async (tx) => {
      await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
      await tx.insert(taskCompletions).values({
        id: completionId,
        taskId: task.id,
        occurrenceAt,
        completedAt: now,
        dueWasNull,
      });
      await tx
        .update(tasks)
        .set({
          dueAt: nextDue,
          startAt: nextStart,
          reminderAt: nextReminderAt,
          status: nextStatus,
          completedAt,
          updatedAt: now,
        })
        .where(eq(tasks.id, task.id));
      if (user.convertArchiveOnComplete) {
        await tx
          .update(inboxItems)
          .set({ status: 'archived', updatedAt: now })
          .where(
            and(
              eq(inboxItems.userId, userId),
              eq(inboxItems.convertedTaskId, task.id),
              eq(inboxItems.status, 'converted'),
            ),
          );
      }
      await syncTaskNotifications(
        {
          ...task,
          dueAt: nextDue,
          reminderAt: nextReminderAt,
          status: nextStatus,
        },
        user,
        now,
        tx,
      );
      if (task.outcomeId) await enqueueOutcomeRefresh(tx, userId, task.outcomeId, now);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.of(409, 'VALIDATION_ERROR');
    throw err;
  }

  const updated = await getOwnedTaskOr404(userId, id);
  fireIndexTask(updated);
  const dto = await dtoOf(updated);
  // Habit relay: completing one count-habit instance spawns the next (rule layer).
  await spawnNextOnComplete(userId, dto, now);
  return { task: dto, undo: { completionId } };
}

export async function uncompleteTask(
  userId: string,
  id: string,
  input: UncompleteTaskInput,
): Promise<Task> {
  const task = await getOwnedTaskOr404(userId, id, { includeDeleted: true });
  if (task.deletedAt) throw AppError.of(404, 'TASK_NOT_FOUND');

  const [completion] = await getDb()
    .select()
    .from(taskCompletions)
    .where(and(eq(taskCompletions.id, input.completionId), eq(taskCompletions.taskId, task.id)))
    .limit(1);
  if (!completion) throw AppError.of(404, 'NOT_FOUND');

  const [latest] = await getDb()
    .select()
    .from(taskCompletions)
    .where(eq(taskCompletions.taskId, task.id))
    .orderBy(desc(taskCompletions.completedAt), desc(taskCompletions.id))
    .limit(1);
  if (latest && latest.id !== completion.id) throw AppError.of(409, 'COMPLETION_NOT_LATEST');

  const now = new Date();
  const restoreNull = completion.dueWasNull && !isRecurring(task);
  const dueAt: Date | null = restoreNull ? null : completion.occurrenceAt;
  let startAt = task.startAt;
  let reminderAt = task.reminderAt;
  if (!restoreNull && task.dueAt) {
    const delta = completion.occurrenceAt.getTime() - task.dueAt.getTime();
    startAt = shiftBy(task.startAt, delta);
    reminderAt = shiftBy(task.reminderAt, delta);
  }

  const user = await getUserEntity(userId);
  await getDb().transaction(async (tx) => {
    await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
    await tx.delete(taskCompletions).where(eq(taskCompletions.id, completion.id));
    await tx
      .update(tasks)
      .set({
        status: 'todo',
        completedAt: null,
        dueAt,
        startAt,
        reminderAt,
        updatedAt: now,
      })
      .where(eq(tasks.id, task.id));
    await syncTaskNotifications(
      {
        ...task,
        status: 'todo',
        dueAt,
        reminderAt,
      },
      user,
      now,
      tx,
    );
    if (task.outcomeId) await enqueueOutcomeRefresh(tx, userId, task.outcomeId, now);
  });
  const restored = await getOwnedTaskOr404(userId, id);
  fireIndexTask(restored);
  return dtoOf(restored);
}

export async function reorderTasks(userId: string, input: ReorderTasksInput): Promise<void> {
  await getOwnedListOr404(userId, input.listId);
  const parentId = input.parentId ?? null;
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.listId, input.listId),
        parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, parentId),
        isNull(tasks.deletedAt),
      ),
    );
  const sibling = new Set(rows.map((r) => r.id));
  for (const id of input.orderedIds) {
    if (!sibling.has(id)) throw AppError.of(404, 'TASK_NOT_FOUND');
  }
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
    for (let i = 0; i < input.orderedIds.length; i += 1) {
      const id = input.orderedIds[i];
      if (id === undefined) continue;
      await tx
        .update(tasks)
        .set({ sortOrder: (i + 1) * SORT_GAP, updatedAt: now })
        .where(eq(tasks.id, id));
    }
  });
}

export async function calendar(userId: string, query: CalendarQuery): Promise<CalendarResponse> {
  const from = new Date(query.from);
  const to = new Date(query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (to.getTime() - from.getTime() > 62 * 24 * 60 * 60 * 1000) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        or(
          isNotNull(tasks.recurrenceRrule),
          isNotNull(tasks.recurrenceKind),
          and(isNotNull(tasks.dueAt), gte(tasks.dueAt, from), lte(tasks.dueAt, to)),
          and(isNotNull(tasks.startAt), gte(tasks.startAt, from), lte(tasks.startAt, to)),
        ),
      ),
    );
  const ids = rows.map((r) => r.id);
  const completions =
    ids.length === 0
      ? []
      : await getDb().select().from(taskCompletions).where(inArray(taskCompletions.taskId, ids));
  const byTask = new Map<string, { occurrenceAt: Date }[]>();
  for (const c of completions) {
    const list = byTask.get(c.taskId) ?? [];
    list.push({ occurrenceAt: c.occurrenceAt });
    byTask.set(c.taskId, list);
  }
  const groups = await Promise.all(
    rows.map(async (row) => {
      const recurrenceKind = asRecurrenceKind(row.recurrenceKind);
      const expanded = recurrenceKind
        ? await expandFixedTask(
            { ...toRecurrence(row), recurrenceKind },
            byTask.get(row.id) ?? [],
            from,
            to,
          )
        : expandTask(toRecurrence(row), byTask.get(row.id) ?? [], from, to);
      return expanded.map((inst) => ({
        taskId: inst.taskId,
        listId: inst.listId,
        title: inst.title,
        occurrenceAt: inst.occurrenceAt.toISOString(),
        isAllDay: inst.isAllDay,
        status: inst.status,
        priority: asPriority(inst.priority),
        pinned: inst.pinned,
      }));
    }),
  );
  const instances = groups.flat();
  instances.sort((a, b) => a.occurrenceAt.localeCompare(b.occurrenceAt));
  return { instances };
}
