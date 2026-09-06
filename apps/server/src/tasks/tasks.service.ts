import { randomUUID } from 'node:crypto';
import {
  type CalendarQuery,
  type CalendarResponse,
  type CompleteTaskResponse,
  type CreateTaskInput,
  type ListTasksQuery,
  type PatchTaskInput,
  type ReorderTasksInput,
  type Task,
  type TaskCollection,
  type TaskPriority,
  type TaskStatus,
  type TimeBucket,
  type UncompleteTaskInput,
} from '@vital/dto';
import {
  and,
  asc,
  type Column,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import {
  inboxItems,
  taskCompletions,
  tasks,
  taskTags,
  type NewTask,
  type TaskRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getInboxList, getOwnedListOr404, SORT_GAP } from '../lists/lists.service.js';
import { syncTaskNotifications } from '../notifications/outbox.js';
import { assertOwnedTagIds } from '../tags/tags.service.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import {
  allDayLocalMidnight,
  expandTask,
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  parseRrule,
  type RecurrenceTask,
} from './recurrence.js';

function asStatus(value: string): TaskStatus {
  if (value === 'todo' || value === 'doing' || value === 'done' || value === 'canceled') {
    return value;
  }
  return 'todo';
}

function asPriority(value: number): TaskPriority {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  return 3;
}

function asBucket(value: string): TimeBucket {
  if (value === 'dated' || value === 'anytime' || value === 'someday') return value;
  return 'anytime';
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toTaskDto(row: TaskRow, tagIds: string[]): Task {
  return {
    id: row.id,
    listId: row.listId,
    parentId: row.parentId,
    title: row.title,
    notes: row.notesMd,
    status: asStatus(row.status),
    priority: asPriority(row.priority),
    dueAt: iso(row.dueAt),
    startAt: iso(row.startAt),
    remindAt: iso(row.remindAt),
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    timeBucket: asBucket(row.timeBucket),
    recurrence: row.recurrenceRrule,
    recurrenceDtstart: iso(row.recurrenceDtstart),
    completedAt: iso(row.completedAt),
    sortOrder: row.sortOrder,
    tagIds,
    deletedAt: iso(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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
  };
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

function bucketAfter(
  dueAt: Date | null,
  startAt: Date | null,
  requested: TimeBucket | undefined,
  previous: TimeBucket,
): TimeBucket {
  if (dueAt !== null || startAt !== null) return 'dated';
  if (requested === 'someday') return 'someday';
  if (requested !== undefined) return requested;
  if (previous === 'someday') return 'someday';
  return 'anytime';
}

function shiftBy(d: Date | null, deltaMs: number): Date | null {
  if (d === null) return null;
  return new Date(d.getTime() + deltaMs);
}

async function nextSortOrder(listId: string, parentId: string | null): Promise<number> {
  const cond =
    parentId === null
      ? and(eq(tasks.listId, listId), isNull(tasks.parentId))
      : and(eq(tasks.listId, listId), eq(tasks.parentId, parentId));
  const [agg] = await getDb().select({ m: max(tasks.sortOrder) }).from(tasks).where(cond);
  return (agg?.m ?? 0) + SORT_GAP;
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
    case 'smart:anytime':
      return and(openCond(userId), eq(tasks.timeBucket, 'anytime')) as SQL;
    case 'smart:someday':
      return and(openCond(userId), eq(tasks.timeBucket, 'someday')) as SQL;
    case 'smart:done':
      return and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        eq(tasks.status, 'done'),
        isNotNull(tasks.completedAt),
        sql`${tasks.completedAt} >= now() - interval '30 days'`,
      ) as SQL;
    default: {
      const list = await getOwnedListOr404(userId, listId);
      return and(eq(tasks.userId, userId), isNull(tasks.deletedAt), eq(tasks.listId, list.id)) as SQL;
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
        or(sql`${tasks.sortOrder} > ${sort}`, and(eq(tasks.sortOrder, sort), sql`${tasks.id} > ${cur.id}`)),
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
  if (input.tagIds !== undefined) await assertOwnedTagIds(userId, input.tagIds);

  const zone = input.timezone ?? user.timezone;
  const isAllDay = input.isAllDay ?? false;
  const dueAt =
    input.dueAt === undefined || input.dueAt === null ? null : parseInstant(input.dueAt, isAllDay, zone);
  const startAt =
    input.startAt === undefined || input.startAt === null
      ? null
      : parseInstant(input.startAt, isAllDay, zone);
  const remindAt =
    input.remindAt === undefined || input.remindAt === null
      ? null
      : parseInstant(input.remindAt, false, zone);

  let recurrence: string | null = null;
  let recurrenceDtstart: Date | null = null;
  if (input.recurrence !== undefined && input.recurrence !== null) {
    if (dueAt === null) throw AppError.of(400, 'RRULE_DUE_REQUIRED');
    parseRrule(input.recurrence);
    recurrence = input.recurrence;
    recurrenceDtstart = dueAt;
  }

  const now = new Date();
  const row: NewTask = {
    id: randomUUID(),
    userId,
    listId,
    parentId,
    title: input.title,
    notesMd: input.notes ?? '',
    status: input.status ?? 'todo',
    priority: input.priority ?? 3,
    dueAt,
    startAt,
    remindAt,
    isAllDay,
    timezone: zone,
    timeBucket: bucketAfter(dueAt, startAt, input.timeBucket, 'anytime'),
    recurrenceRrule: recurrence,
    recurrenceDtstart,
    completedAt: null,
    sortOrder: await nextSortOrder(listId, parentId),
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().transaction(async (tx) => {
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
        remindAt: row.remindAt ?? null,
        isAllDay: row.isAllDay ?? false,
        timezone: row.timezone,
        deletedAt: row.deletedAt ?? null,
      },
      user,
      now,
      tx,
    );
  });
  const [created] = await getDb().select().from(tasks).where(eq(tasks.id, row.id)).limit(1);
  if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
  return dtoOf(created);
}

export async function patchTask(userId: string, id: string, input: PatchTaskInput): Promise<Task> {
  const task = await getOwnedTaskOr404(userId, id);
  if (input.tagIds !== undefined) await assertOwnedTagIds(userId, input.tagIds);
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
  let remindAt = task.remindAt;
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
  if (input.remindAt !== undefined) {
    remindAt = input.remindAt === null ? null : parseInstant(input.remindAt, false, zone);
  }

  let recurrence = task.recurrenceRrule;
  let recurrenceDtstart = task.recurrenceDtstart;
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
      remindAt = shiftBy(remindAt, delta);
    }
    dueAt = snapped;
  }

  const now = new Date();
  const patch: Partial<TaskRow> = {
    updatedAt: now,
    timezone: zone,
    isAllDay,
    dueAt,
    startAt,
    remindAt,
    recurrenceRrule: recurrence,
    recurrenceDtstart,
    timeBucket: bucketAfter(dueAt, startAt, input.timeBucket, asBucket(task.timeBucket)),
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notesMd = input.notes ?? '';
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.listId !== undefined) patch.listId = input.listId;

  const user = await getUserEntity(userId);
  await getDb().transaction(async (tx) => {
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
        remindAt: patch.remindAt !== undefined ? patch.remindAt : task.remindAt,
        isAllDay: patch.isAllDay ?? task.isAllDay,
        timezone: patch.timezone ?? task.timezone,
        deletedAt: task.deletedAt,
      },
      user,
      now,
      tx,
    );
  });
  return dtoOf(await getOwnedTaskOr404(userId, id));
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const task = await getOwnedTaskOr404(userId, id);
  const user = await getUserEntity(userId);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    if (task.parentId) {
      await tx.update(tasks).set({ deletedAt: now, updatedAt: now }).where(eq(tasks.id, task.id));
      await syncTaskNotifications({ ...task, deletedAt: now }, user, now, tx);
      return;
    }
    const children = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentId, task.id), eq(tasks.userId, userId)));
    await tx
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(eq(tasks.userId, userId), or(eq(tasks.id, task.id), eq(tasks.parentId, task.id))),
      );
    await syncTaskNotifications({ ...task, deletedAt: now }, user, now, tx);
    for (const child of children) {
      await syncTaskNotifications({ ...child, deletedAt: now }, user, now, tx);
    }
  });
}

export async function restoreTask(userId: string, id: string): Promise<Task> {
  const task = await getOwnedTaskOr404(userId, id, { includeDeleted: true });
  const user = await getUserEntity(userId);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    if (task.parentId) {
      await tx
        .update(tasks)
        .set({ deletedAt: null, updatedAt: now })
        .where(eq(tasks.id, task.id));
      await syncTaskNotifications({ ...task, deletedAt: null }, user, now, tx);
      return;
    }
    const children = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentId, task.id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt)));
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
  });
  return dtoOf(await getOwnedTaskOr404(userId, id));
}

export async function completeTask(userId: string, id: string): Promise<CompleteTaskResponse> {
  const task = await getOwnedTaskOr404(userId, id);
  if (task.status === 'canceled') throw AppError.of(400, 'VALIDATION_ERROR');
  if (task.status === 'done' && !task.recurrenceRrule) throw AppError.of(409, 'VALIDATION_ERROR');
  const user = await getUserEntity(userId);

  const now = new Date();
  const dueWasNull = task.dueAt === null;
  const occurrenceAt = task.dueAt ?? now;
  const completionId = randomUUID();

  let nextDue = task.dueAt;
  let nextStart = task.startAt;
  let nextRemind = task.remindAt;
  let nextStatus: TaskStatus = 'done';
  let completedAt: Date | null = now;

  if (task.recurrenceRrule && task.dueAt) {
    const nxt = nextOccurrenceAfter(toRecurrence(task), task.dueAt);
    if (nxt) {
      const delta = nxt.getTime() - task.dueAt.getTime();
      nextDue = nxt;
      nextStart = shiftBy(task.startAt, delta);
      nextRemind = shiftBy(task.remindAt, delta);
      nextStatus = 'todo';
      completedAt = null;
    }
  }

  try {
    await getDb().transaction(async (tx) => {
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
          remindAt: nextRemind,
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
          remindAt: nextRemind,
          status: nextStatus,
        },
        user,
        now,
        tx,
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.of(409, 'VALIDATION_ERROR');
    throw err;
  }

  const updated = await getOwnedTaskOr404(userId, id);
  return { task: await dtoOf(updated), undo: { completionId } };
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
  const restoreNull = completion.dueWasNull && !task.recurrenceRrule;
  const dueAt: Date | null = restoreNull ? null : completion.occurrenceAt;
  let startAt = task.startAt;
  let remindAt = task.remindAt;
  if (!restoreNull && task.dueAt) {
    const delta = completion.occurrenceAt.getTime() - task.dueAt.getTime();
    startAt = shiftBy(task.startAt, delta);
    remindAt = shiftBy(task.remindAt, delta);
  }

  const user = await getUserEntity(userId);
  await getDb().transaction(async (tx) => {
    await tx.delete(taskCompletions).where(eq(taskCompletions.id, completion.id));
    await tx
      .update(tasks)
      .set({
        status: 'todo',
        completedAt: null,
        dueAt,
        startAt,
        remindAt,
        updatedAt: now,
      })
      .where(eq(tasks.id, task.id));
    await syncTaskNotifications(
      {
        ...task,
        status: 'todo',
        dueAt,
        remindAt,
      },
      user,
      now,
      tx,
    );
  });
  return dtoOf(await getOwnedTaskOr404(userId, id));
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
  const instances = rows.flatMap((row) =>
    expandTask(toRecurrence(row), byTask.get(row.id) ?? [], from, to).map((inst) => ({
      taskId: inst.taskId,
      listId: inst.listId,
      title: inst.title,
      occurrenceAt: inst.occurrenceAt.toISOString(),
      isAllDay: inst.isAllDay,
      status: inst.status,
      priority: asPriority(inst.priority),
    })),
  );
  instances.sort((a, b) => a.occurrenceAt.localeCompare(b.occurrenceAt));
  return { instances };
}
