import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type {
  CoverPreset,
  CreateDayInput,
  Day,
  DayCalendar,
  DayCatalogItem,
  DayCatalogResponse,
  DayDisplayMode,
  DayHolidayRange,
  DayReminderOffset,
  PatchDayInput,
  UpcomingDay,
} from '@vital/dto';
import { MAX_PINNED_DAYS, MAX_VISIBLE_DAYS } from '@vital/dto';
import { getDb, type Database } from '../db/index.js';
import {
  attachments,
  days,
  holidayCalendar,
  type DayRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getUserEntity } from '../auth/auth.service.js';
import { bindUpload, resolveAccessUrl } from '../uploads/uploads.service.js';
import { catalogByKey, catalogKindOf, DAY_CATALOG, STATUTORY_KEYS } from './catalog.js';
import { computeOccurrence, guessCoverPreset, lunarFieldsFromSolar, resolveCustomAnchor } from './compute.js';
import { isCoverPreset, presetCoverUrl } from './covers.js';
import { addDaysYmd, leapMonthOf, solarToLunar } from './lunar.js';
import { cancelDayNotifications, syncDayNotifications } from './outbox.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function todayOf(now: Date, timezone: string): string {
  const day = DateTime.fromJSDate(now).setZone(timezone).toISODate();
  if (!day) throw new Error('invalid local date');
  return day;
}

function asCalendar(value: string): DayCalendar {
  return value === 'lunar' ? 'lunar' : 'solar';
}

function asRepeat(value: string): 'none' | 'yearly' {
  return value === 'yearly' ? 'yearly' : 'none';
}

function asDisplay(value: string): DayDisplayMode {
  if (value === 'countdown' || value === 'countup') return value;
  return 'auto';
}

function asOffsets(value: unknown): DayReminderOffset[] {
  if (!Array.isArray(value)) return [];
  const allowed: DayReminderOffset[] = [0, 1, 3, 7, 30];
  return allowed.filter((item) => value.includes(item));
}

function asPreset(value: string): CoverPreset {
  return isCoverPreset(value) ? value : 'mist';
}

async function holidayRangeAround(ymd: string): Promise<DayHolidayRange | null> {
  const from = addDaysYmd(ymd, -10);
  const to = addDaysYmd(ymd, 14);
  const rows = await getDb()
    .select({ date: holidayCalendar.date, kind: holidayCalendar.kind })
    .from(holidayCalendar)
    .where(
      and(
        eq(holidayCalendar.region, 'CN'),
        gte(holidayCalendar.date, from),
        lte(holidayCalendar.date, to),
      ),
    );
  const holidays = new Set(rows.filter((row) => row.kind === 'holiday').map((row) => row.date));
  if (!holidays.has(ymd)) return null;
  let start = ymd;
  let end = ymd;
  while (holidays.has(addDaysYmd(start, -1))) start = addDaysYmd(start, -1);
  while (holidays.has(addDaysYmd(end, 1))) end = addDaysYmd(end, 1);
  return { from: start, to: end };
}

async function coverUrlOf(userId: string, row: DayRow): Promise<string> {
  const fallback = presetCoverUrl(asPreset(row.coverPreset));
  if (!row.coverAttachmentId) return fallback;
  try {
    return await resolveAccessUrl(userId, row.coverAttachmentId);
  } catch {
    return fallback;
  }
}

function toDayDto(
  row: DayRow,
  today: string,
  coverUrl: string,
  holidayRange: DayHolidayRange | null,
): Day {
  const occ = computeOccurrence(
    {
      calendar: asCalendar(row.calendar),
      repeat: asRepeat(row.repeat),
      displayMode: asDisplay(row.displayMode),
      anchorYmd: row.anchorYmd,
      lunarMonth: row.lunarMonth,
      lunarDay: row.lunarDay,
      lunarLeap: row.lunarLeap,
      catalogKey: row.catalogKey,
    },
    today,
  );
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    source: row.source === 'statutory' || row.source === 'catalog' ? row.source : 'custom',
    catalogKey: row.catalogKey,
    catalogKind: catalogKindOf(row.catalogKey),
    calendar: asCalendar(row.calendar),
    repeat: asRepeat(row.repeat),
    displayMode: asDisplay(row.displayMode),
    anchorYmd: row.anchorYmd,
    nextYmd: occ.nextYmd,
    prevYmd: occ.prevYmd,
    lunarMonth: row.lunarMonth,
    lunarDay: row.lunarDay,
    lunarLeap: row.lunarLeap,
    lunarLabel: occ.lunarLabel,
    solarLabel: occ.solarLabel,
    timeHm: row.timeHm,
    coverPreset: asPreset(row.coverPreset),
    coverAttachmentId: row.coverAttachmentId,
    coverUrl,
    reminderOffsets: asOffsets(row.reminderOffsets),
    pinned: row.pinned,
    hidden: row.hidden,
    canDelete: row.source !== 'statutory',
    headline: occ.headline,
    holidayRange,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sortDays(items: Day[]): Day[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return 0;
    if (a.headline.kind === 'today' && b.headline.kind !== 'today') return -1;
    if (b.headline.kind === 'today' && a.headline.kind !== 'today') return 1;
    if (a.headline.kind === 'countdown' && b.headline.kind === 'countdown') {
      return a.headline.days - b.headline.days;
    }
    if (a.headline.kind === 'countdown') return -1;
    if (b.headline.kind === 'countdown') return 1;
    return a.headline.days - b.headline.days;
  });
}

async function hydrate(userId: string, rows: DayRow[], today: string): Promise<Day[]> {
  const items = await Promise.all(
    rows.map(async (row) => {
      const coverUrl = await coverUrlOf(userId, row);
      const focus = computeOccurrence(
        {
          calendar: asCalendar(row.calendar),
          repeat: asRepeat(row.repeat),
          displayMode: asDisplay(row.displayMode),
          anchorYmd: row.anchorYmd,
          lunarMonth: row.lunarMonth,
          lunarDay: row.lunarDay,
          lunarLeap: row.lunarLeap,
          catalogKey: row.catalogKey,
        },
        today,
      );
      const holidayYmd = focus.nextYmd ?? focus.prevYmd;
      const range =
        row.source === 'statutory' || row.catalogKey
          ? await holidayRangeAround(holidayYmd)
          : null;
      return toDayDto(row, today, coverUrl, range);
    }),
  );
  const pinned = items.filter((item) => item.pinned);
  const rest = sortDays(items.filter((item) => !item.pinned));
  return [...pinned, ...rest];
}

async function getOwnedDayOr404(userId: string, id: string): Promise<DayRow> {
  const [row] = await getDb().select().from(days).where(eq(days.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

async function visibleCount(userId: string, tx: Tx | Database = getDb()): Promise<number> {
  const rows = await tx
    .select({ id: days.id })
    .from(days)
    .where(and(eq(days.userId, userId), eq(days.hidden, false)));
  return rows.length;
}

async function enforcePinLimit(userId: string, keepId: string, tx: Tx): Promise<void> {
  const pinned = await tx
    .select()
    .from(days)
    .where(and(eq(days.userId, userId), eq(days.pinned, true)))
    .orderBy(asc(days.pinOrder), asc(days.createdAt));
  const others = pinned.filter((row) => row.id !== keepId);
  if (others.length < MAX_PINNED_DAYS) return;
  const drop = others[0];
  if (!drop) return;
  await tx
    .update(days)
    .set({ pinned: false, pinOrder: 0, updatedAt: new Date() })
    .where(eq(days.id, drop.id));
}

async function nextPinOrder(userId: string, tx: Tx): Promise<number> {
  const rows = await tx
    .select({ pinOrder: days.pinOrder })
    .from(days)
    .where(and(eq(days.userId, userId), eq(days.pinned, true)))
    .orderBy(desc(days.pinOrder))
    .limit(1);
  return (rows[0]?.pinOrder ?? 0) + 1;
}

async function attachCover(
  userId: string,
  dayId: string,
  attachmentId: string | null,
  previousId: string | null,
): Promise<string | null> {
  if (attachmentId === null) {
    if (previousId) {
      await getDb()
        .update(attachments)
        .set({ status: 'orphaned', orphanedAt: new Date() })
        .where(and(eq(attachments.id, previousId), eq(attachments.userId, userId)));
    }
    return null;
  }
  const [att] = await getDb()
    .select()
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!att || att.userId !== userId || att.status !== 'ready') {
    throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
  }
  if (att.ownerType === 'tmp') {
    await bindUpload(userId, attachmentId, { ownerType: 'day', ownerId: dayId });
  } else if (att.ownerType !== 'day' || att.ownerId !== dayId) {
    throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
  }
  if (previousId && previousId !== attachmentId) {
    await getDb()
      .update(attachments)
      .set({ status: 'orphaned', orphanedAt: new Date() })
      .where(and(eq(attachments.id, previousId), eq(attachments.userId, userId)));
  }
  return attachmentId;
}

function catalogRowValues(userId: string, key: string, now: Date, today: string): typeof days.$inferInsert {
  const def = catalogByKey(key);
  if (!def) throw AppError.of(400, 'VALIDATION_ERROR');
  const anchorYmd = def.occurrenceInYear(Number(today.slice(0, 4)));
  const lunar =
    def.calendar === 'lunar'
      ? solarToLunar(anchorYmd)
      : { month: null as number | null, day: null as number | null, leap: false };
  return {
    id: randomUUID(),
    userId,
    name: def.name,
    note: '',
    source: def.kind === 'statutory' ? 'statutory' : 'catalog',
    catalogKey: def.key,
    calendar: def.calendar,
    repeat: 'yearly',
    displayMode: 'auto',
    anchorYmd,
    lunarMonth: lunar.month,
    lunarDay: lunar.day,
    lunarLeap: lunar.leap,
    timeHm: null,
    coverPreset: def.defaultCover,
    coverAttachmentId: null,
    reminderOffsets: def.defaultReminders,
    pinned: false,
    pinOrder: 0,
    hidden: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function ensureStatutoryDays(
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<void> {
  const today = todayOf(now, timezone);
  const existing = await getDb()
    .select({ catalogKey: days.catalogKey })
    .from(days)
    .where(and(eq(days.userId, userId), inArray(days.catalogKey, [...STATUTORY_KEYS])));
  const have = new Set(existing.map((row) => row.catalogKey));
  const missing = STATUTORY_KEYS.filter((key) => !have.has(key));
  if (missing.length === 0) return;
  const user = await getUserEntity(userId);
  await getDb().transaction(async (tx) => {
    for (const key of missing) {
      const values = catalogRowValues(userId, key, now, today);
      await tx.insert(days).values(values);
    }
    const rows = await tx
      .select()
      .from(days)
      .where(and(eq(days.userId, userId), inArray(days.catalogKey, missing)));
    for (const row of rows) {
      await syncDayNotifications(row, user, now, tx);
    }
  });
}

export async function listDays(userId: string, timezone: string, now = new Date()): Promise<Day[]> {
  await ensureStatutoryDays(userId, timezone, now);
  const today = todayOf(now, timezone);
  const rows = await getDb()
    .select()
    .from(days)
    .where(and(eq(days.userId, userId), eq(days.hidden, false)))
    .orderBy(desc(days.pinned), asc(days.pinOrder), asc(days.createdAt));
  return hydrate(userId, rows, today);
}

export async function listDayCatalog(
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<DayCatalogResponse> {
  await ensureStatutoryDays(userId, timezone, now);
  const rows = await getDb()
    .select({ catalogKey: days.catalogKey, hidden: days.hidden })
    .from(days)
    .where(eq(days.userId, userId));
  const byKey = new Map(
    rows.filter((row) => row.catalogKey).map((row) => [row.catalogKey as string, row]),
  );
  const items: DayCatalogItem[] = DAY_CATALOG.map((def) => {
    const row = byKey.get(def.key);
    return {
      key: def.key,
      name: def.name,
      kind: def.kind,
      calendar: def.calendar,
      defaultCover: def.defaultCover,
      added: Boolean(row && !row.hidden),
      hidden: Boolean(row?.hidden),
    };
  });
  return { items };
}

export function getDayCalendarMeta(year: number): { year: number; leapMonth: number | null } {
  return { year, leapMonth: leapMonthOf(year) };
}

export async function getDay(userId: string, id: string, timezone: string, now = new Date()): Promise<Day> {
  await ensureStatutoryDays(userId, timezone, now);
  const row = await getOwnedDayOr404(userId, id);
  const today = todayOf(now, timezone);
  const [dto] = await hydrate(userId, [row], today);
  if (!dto) throw AppError.of(404, 'NOT_FOUND');
  return dto;
}

export async function upcomingDay(
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<UpcomingDay | null> {
  const items = await listDays(userId, timezone, now);
  let best: Day | null = null;
  for (const item of items) {
    if (item.headline.kind !== 'today' && item.headline.kind !== 'countdown') continue;
    if (item.headline.days > 7) continue;
    if (!best || item.headline.days < best.headline.days) best = item;
  }
  if (!best) return null;
  return { id: best.id, name: best.name, daysUntil: best.headline.days };
}

export async function createDay(
  userId: string,
  input: CreateDayInput,
  timezone: string,
  now = new Date(),
): Promise<Day> {
  const user = await getUserEntity(userId);
  const today = todayOf(now, timezone);

  if (input.catalogKey) {
    const def = catalogByKey(input.catalogKey);
    if (!def) throw AppError.of(400, 'VALIDATION_ERROR');
    const [existing] = await getDb()
      .select()
      .from(days)
      .where(and(eq(days.userId, userId), eq(days.catalogKey, input.catalogKey)))
      .limit(1);
    if (existing) {
      if (existing.hidden) {
        if ((await visibleCount(userId)) >= MAX_VISIBLE_DAYS) {
          throw AppError.of(400, 'DAY_LIMIT_REACHED');
        }
        const [updated] = await getDb().transaction(async (tx) => {
          const next = await tx
            .update(days)
            .set({ hidden: false, updatedAt: now })
            .where(eq(days.id, existing.id))
            .returning();
          const row = next[0];
          if (row) await syncDayNotifications(row, user, now, tx);
          return next;
        });
        const row = updated ?? existing;
        const [dto] = await hydrate(userId, [row], today);
        if (!dto) throw AppError.of(404, 'NOT_FOUND');
        return dto;
      }
      const [dto] = await hydrate(userId, [existing], today);
      if (!dto) throw AppError.of(404, 'NOT_FOUND');
      return dto;
    }
    if ((await visibleCount(userId)) >= MAX_VISIBLE_DAYS) {
      throw AppError.of(400, 'DAY_LIMIT_REACHED');
    }
    const values = catalogRowValues(userId, input.catalogKey, now, today);
    if (input.coverPreset) values.coverPreset = input.coverPreset;
    if (input.reminderOffsets) values.reminderOffsets = input.reminderOffsets;
    if (input.pinned) {
      values.pinned = true;
    }
    const row = await getDb().transaction(async (tx) => {
      if (values.pinned) {
        await enforcePinLimit(userId, values.id, tx);
        values.pinOrder = await nextPinOrder(userId, tx);
      }
      const [created] = await tx.insert(days).values(values).returning();
      if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
      await syncDayNotifications(created, user, now, tx);
      return created;
    });
    if (input.coverAttachmentId) {
      const coverId = await attachCover(userId, row.id, input.coverAttachmentId, null);
      const [next] = await getDb()
        .update(days)
        .set({ coverAttachmentId: coverId, updatedAt: now })
        .where(eq(days.id, row.id))
        .returning();
      const [dto] = await hydrate(userId, [next ?? row], today);
      if (!dto) throw AppError.of(404, 'NOT_FOUND');
      return dto;
    }
    const [dto] = await hydrate(userId, [row], today);
    if (!dto) throw AppError.of(404, 'NOT_FOUND');
    return dto;
  }

  if ((await visibleCount(userId)) >= MAX_VISIBLE_DAYS) {
    throw AppError.of(400, 'DAY_LIMIT_REACHED');
  }
  const calendar = input.calendar ?? 'solar';
  let resolved;
  try {
    resolved = resolveCustomAnchor({
      calendar,
      anchorYmd: input.anchorYmd,
      lunarYear: input.lunarYear,
      lunarMonth: input.lunarMonth,
      lunarDay: input.lunarDay,
      lunarLeap: input.lunarLeap,
    });
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const name = (input.name ?? '').trim();
  const values: typeof days.$inferInsert = {
    id: randomUUID(),
    userId,
    name,
    note: input.note?.trim() ?? '',
    source: 'custom',
    catalogKey: null,
    calendar,
    repeat: input.repeat ?? 'none',
    displayMode: input.displayMode ?? 'auto',
    anchorYmd: resolved.anchorYmd,
    lunarMonth: resolved.lunarMonth,
    lunarDay: resolved.lunarDay,
    lunarLeap: resolved.lunarLeap,
    timeHm: input.timeHm === undefined ? null : input.timeHm,
    coverPreset: input.coverPreset ?? guessCoverPreset(name),
    coverAttachmentId: null,
    reminderOffsets: input.reminderOffsets ?? [],
    pinned: input.pinned === true,
    pinOrder: 0,
    hidden: false,
    createdAt: now,
    updatedAt: now,
  };
  const row = await getDb().transaction(async (tx) => {
    if (values.pinned) {
      await enforcePinLimit(userId, values.id, tx);
      values.pinOrder = await nextPinOrder(userId, tx);
    }
    const [created] = await tx.insert(days).values(values).returning();
    if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
    await syncDayNotifications(created, user, now, tx);
    return created;
  });
  if (input.coverAttachmentId) {
    const coverId = await attachCover(userId, row.id, input.coverAttachmentId, null);
    const [next] = await getDb()
      .update(days)
      .set({ coverAttachmentId: coverId, updatedAt: now })
      .where(eq(days.id, row.id))
      .returning();
    const [dto] = await hydrate(userId, [next ?? row], today);
    if (!dto) throw AppError.of(404, 'NOT_FOUND');
    return dto;
  }
  const [dto] = await hydrate(userId, [row], today);
  if (!dto) throw AppError.of(404, 'NOT_FOUND');
  return dto;
}

export async function patchDay(
  userId: string,
  id: string,
  input: PatchDayInput,
  timezone: string,
  now = new Date(),
): Promise<Day> {
  const user = await getUserEntity(userId);
  const current = await getOwnedDayOr404(userId, id);
  const today = todayOf(now, timezone);
  const patch: Partial<DayRow> = { updatedAt: now };

  if (input.name !== undefined) patch.name = input.name;
  if (input.note !== undefined) patch.note = input.note ?? '';
  if (input.repeat !== undefined) patch.repeat = input.repeat;
  if (input.displayMode !== undefined) patch.displayMode = input.displayMode;
  if (input.timeHm !== undefined) patch.timeHm = input.timeHm;
  if (input.coverPreset !== undefined) patch.coverPreset = input.coverPreset;
  if (input.reminderOffsets !== undefined) patch.reminderOffsets = input.reminderOffsets;
  if (input.hidden !== undefined) {
    if (!input.hidden && current.hidden && (await visibleCount(userId)) >= MAX_VISIBLE_DAYS) {
      throw AppError.of(400, 'DAY_LIMIT_REACHED');
    }
    patch.hidden = input.hidden;
  }

  const nextCalendar = input.calendar ?? asCalendar(current.calendar);
  const dateTouched =
    input.calendar !== undefined ||
    input.anchorYmd !== undefined ||
    input.lunarYear !== undefined ||
    input.lunarMonth !== undefined ||
    input.lunarDay !== undefined ||
    input.lunarLeap !== undefined;
  if (dateTouched) {
    try {
      if (nextCalendar === 'lunar') {
        if (
          input.lunarYear !== undefined ||
          input.lunarMonth !== undefined ||
          input.lunarDay !== undefined ||
          input.lunarLeap !== undefined
        ) {
          const resolved = resolveCustomAnchor({
            calendar: 'lunar',
            lunarYear: input.lunarYear ?? Number(today.slice(0, 4)),
            lunarMonth: input.lunarMonth ?? current.lunarMonth,
            lunarDay: input.lunarDay ?? current.lunarDay,
            lunarLeap: input.lunarLeap ?? current.lunarLeap,
          });
          patch.calendar = 'lunar';
          patch.anchorYmd = resolved.anchorYmd;
          patch.lunarMonth = resolved.lunarMonth;
          patch.lunarDay = resolved.lunarDay;
          patch.lunarLeap = resolved.lunarLeap;
        } else {
          const ymd = input.anchorYmd ?? current.anchorYmd;
          const lunar = lunarFieldsFromSolar(ymd);
          patch.calendar = 'lunar';
          patch.anchorYmd = ymd;
          patch.lunarMonth = lunar.lunarMonth;
          patch.lunarDay = lunar.lunarDay;
          patch.lunarLeap = lunar.lunarLeap;
        }
      } else {
        patch.calendar = 'solar';
        patch.anchorYmd = input.anchorYmd ?? current.anchorYmd;
        patch.lunarMonth = null;
        patch.lunarDay = null;
        patch.lunarLeap = false;
      }
    } catch {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
  }

  if (input.coverAttachmentId !== undefined) {
    patch.coverAttachmentId = await attachCover(
      userId,
      id,
      input.coverAttachmentId,
      current.coverAttachmentId,
    );
  }

  const row = await getDb().transaction(async (tx) => {
    if (input.pinned === true && !current.pinned) {
      await enforcePinLimit(userId, id, tx);
      patch.pinned = true;
      patch.pinOrder = await nextPinOrder(userId, tx);
    } else if (input.pinned === false) {
      patch.pinned = false;
      patch.pinOrder = 0;
    }
    const [updated] = await tx.update(days).set(patch).where(eq(days.id, id)).returning();
    if (!updated) throw AppError.of(404, 'NOT_FOUND');
    if (updated.hidden) await cancelDayNotifications(id, now, tx);
    else await syncDayNotifications(updated, user, now, tx);
    return updated;
  });
  const [dto] = await hydrate(userId, [row], today);
  if (!dto) throw AppError.of(404, 'NOT_FOUND');
  return dto;
}

export async function deleteDay(userId: string, id: string, now = new Date()): Promise<void> {
  const row = await getOwnedDayOr404(userId, id);
  if (row.source === 'statutory') throw AppError.of(400, 'DAY_NOT_DELETABLE');
  await getDb().transaction(async (tx) => {
    await cancelDayNotifications(id, now, tx);
    if (row.coverAttachmentId) {
      await tx
        .update(attachments)
        .set({ status: 'orphaned', orphanedAt: now })
        .where(and(eq(attachments.id, row.coverAttachmentId), eq(attachments.userId, userId)));
    }
    await tx.delete(days).where(eq(days.id, id));
  });
}
