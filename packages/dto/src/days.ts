import { z } from 'zod';
import { uuidSchema } from './lists.js';

export const COVER_PRESETS = [
  'mist',
  'night',
  'blossom',
  'paper',
  'lantern',
  'silk',
  'moon',
  'willow',
  'river',
  'field',
  'tea',
  'snow',
] as const;
export type CoverPreset = (typeof COVER_PRESETS)[number];
export const coverPresetSchema = z.enum(COVER_PRESETS);

export const DAY_SOURCES = ['custom', 'statutory', 'catalog'] as const;
export type DaySource = (typeof DAY_SOURCES)[number];
export const daySourceSchema = z.enum(DAY_SOURCES);

export const DAY_CALENDARS = ['solar', 'lunar'] as const;
export type DayCalendar = (typeof DAY_CALENDARS)[number];
export const dayCalendarSchema = z.enum(DAY_CALENDARS);

export const DAY_REPEATS = ['none', 'yearly'] as const;
export type DayRepeat = (typeof DAY_REPEATS)[number];
export const dayRepeatSchema = z.enum(DAY_REPEATS);

export const DAY_DISPLAY_MODES = ['auto', 'countdown', 'countup'] as const;
export type DayDisplayMode = (typeof DAY_DISPLAY_MODES)[number];
export const dayDisplayModeSchema = z.enum(DAY_DISPLAY_MODES);

export const DAY_REMINDER_OFFSETS = [0, 1, 3, 7, 30] as const;
export type DayReminderOffset = (typeof DAY_REMINDER_OFFSETS)[number];
export const dayReminderOffsetSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(3),
  z.literal(7),
  z.literal(30),
]);

export const DAY_CATALOG_KINDS = ['statutory', 'traditional', 'international'] as const;
export type DayCatalogKind = (typeof DAY_CATALOG_KINDS)[number];
export const dayCatalogKindSchema = z.enum(DAY_CATALOG_KINDS);

export const DAY_HEADLINE_KINDS = ['today', 'countdown', 'countup'] as const;
export type DayHeadlineKind = (typeof DAY_HEADLINE_KINDS)[number];

export const MAX_VISIBLE_DAYS = 200;
export const MAX_PINNED_DAYS = 2;
export const MAX_DAY_NAME = 80;
export const MAX_DAY_NOTE = 200;

export const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'INVALID_YMD' });
const hmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'INVALID_HM' });

export interface DayHeadline {
  kind: DayHeadlineKind;
  /** Calendar days (0 on the day itself). */
  days: number;
  /** Completed yearly cycles; null when not yearly or still year 0. */
  years: number | null;
}

export interface DayHolidayRange {
  from: string;
  to: string;
}

export interface Day {
  id: string;
  name: string;
  note: string;
  source: DaySource;
  catalogKey: string | null;
  catalogKind: DayCatalogKind | null;
  calendar: DayCalendar;
  repeat: DayRepeat;
  displayMode: DayDisplayMode;
  /** First occurrence as a solar YYYY-MM-DD (count-up origin). */
  anchorYmd: string;
  /** Next occurrence on or after today; null when a one-shot date is already past. */
  nextYmd: string | null;
  /** Latest occurrence on or before today (anchor when still in the future). */
  prevYmd: string;
  lunarMonth: number | null;
  lunarDay: number | null;
  lunarLeap: boolean;
  lunarLabel: string | null;
  solarLabel: string;
  timeHm: string | null;
  coverPreset: CoverPreset;
  coverAttachmentId: string | null;
  /** Preset public URL or a 6-hour signed upload URL. */
  coverUrl: string;
  reminderOffsets: DayReminderOffset[];
  pinned: boolean;
  hidden: boolean;
  canDelete: boolean;
  headline: DayHeadline;
  holidayRange: DayHolidayRange | null;
  createdAt: string;
  updatedAt: string;
}

export interface DayCollection {
  items: Day[];
}

export interface DayCatalogItem {
  key: string;
  name: string;
  kind: DayCatalogKind;
  calendar: DayCalendar;
  defaultCover: CoverPreset;
  added: boolean;
  hidden: boolean;
}

export interface DayCatalogResponse {
  items: DayCatalogItem[];
}

export interface DayCalendarMeta {
  year: number;
  leapMonth: number | null;
}

export interface UpcomingDay {
  id: string;
  name: string;
  daysUntil: number;
}

export const dayIdParamsSchema = z.object({ id: uuidSchema });
export type DayIdParams = z.infer<typeof dayIdParamsSchema>;

export const dayCalendarMetaQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
});
export type DayCalendarMetaQuery = z.infer<typeof dayCalendarMetaQuerySchema>;

const reminderOffsetsSchema = z
  .array(dayReminderOffsetSchema)
  .max(DAY_REMINDER_OFFSETS.length)
  .transform((value) => [...new Set(value)].sort((a, b) => a - b));

export const createDayInputSchema = z
  .object({
    catalogKey: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(MAX_DAY_NAME).optional(),
    note: z.string().trim().max(MAX_DAY_NOTE).optional(),
    calendar: dayCalendarSchema.optional(),
    anchorYmd: ymdSchema.optional(),
    lunarYear: z.number().int().min(1900).max(2100).optional(),
    lunarMonth: z.number().int().min(1).max(12).optional(),
    lunarDay: z.number().int().min(1).max(30).optional(),
    lunarLeap: z.boolean().optional(),
    repeat: dayRepeatSchema.optional(),
    displayMode: dayDisplayModeSchema.optional(),
    timeHm: hmSchema.nullable().optional(),
    coverPreset: coverPresetSchema.optional(),
    coverAttachmentId: uuidSchema.nullable().optional(),
    reminderOffsets: reminderOffsetsSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.catalogKey !== undefined) return;
    if (value.name === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'name required', path: ['name'] });
    }
    const calendar = value.calendar ?? 'solar';
    if (calendar === 'solar' && value.anchorYmd === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'anchorYmd required', path: ['anchorYmd'] });
    }
    if (calendar === 'lunar') {
      if (value.lunarYear === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'lunarYear required', path: ['lunarYear'] });
      }
      if (value.lunarMonth === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'lunarMonth required', path: ['lunarMonth'] });
      }
      if (value.lunarDay === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'lunarDay required', path: ['lunarDay'] });
      }
    }
  });
export type CreateDayInput = z.infer<typeof createDayInputSchema>;

export const patchDayInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_DAY_NAME).optional(),
    note: z.string().trim().max(MAX_DAY_NOTE).nullable().optional(),
    calendar: dayCalendarSchema.optional(),
    anchorYmd: ymdSchema.optional(),
    lunarYear: z.number().int().min(1900).max(2100).optional(),
    lunarMonth: z.number().int().min(1).max(12).nullable().optional(),
    lunarDay: z.number().int().min(1).max(30).nullable().optional(),
    lunarLeap: z.boolean().optional(),
    repeat: dayRepeatSchema.optional(),
    displayMode: dayDisplayModeSchema.optional(),
    timeHm: hmSchema.nullable().optional(),
    coverPreset: coverPresetSchema.optional(),
    coverAttachmentId: uuidSchema.nullable().optional(),
    reminderOffsets: reminderOffsetsSchema.optional(),
    pinned: z.boolean().optional(),
    hidden: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchDayInput = z.infer<typeof patchDayInputSchema>;
