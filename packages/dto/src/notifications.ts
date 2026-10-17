import { z } from 'zod';
import { uuidSchema } from './lists.js';

export const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'INVALID_TIME');
export type Hhmm = z.infer<typeof hhmmSchema>;

export const notificationPrefsSchema = z.object({
  taskRemind: z.boolean(),
  taskDue: z.boolean(),
  agentInsights: z.boolean(),
  dayRemind: z.boolean(),
  morningBrief: z.boolean(),
  morningBriefTime: hhmmSchema,
  meetingPrep: z.boolean(),
  weeklyObserve: z.boolean(),
  agentErrand: z.boolean(),
  /** When false, chat does not propose a schedule card. */
  scheduleSuggest: z.boolean(),
  workHoursStart: hhmmSchema,
  workHoursEnd: hhmmSchema,
  scheduleDayCapMinutes: z.number().int().min(30).max(1440),
  quietHoursStart: hhmmSchema.nullable(),
  quietHoursEnd: hhmmSchema.nullable(),
  allDayNotifyTime: hhmmSchema,
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  taskRemind: true,
  taskDue: true,
  agentInsights: true,
  dayRemind: true,
  morningBrief: true,
  morningBriefTime: '07:30',
  meetingPrep: true,
  weeklyObserve: true,
  agentErrand: true,
  scheduleSuggest: true,
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  scheduleDayCapMinutes: 540,
  quietHoursStart: null,
  quietHoursEnd: null,
  allDayNotifyTime: '09:00',
};

export const patchNotificationPrefsSchema = z
  .object({
    taskRemind: z.boolean().optional(),
    taskDue: z.boolean().optional(),
    agentInsights: z.boolean().optional(),
    dayRemind: z.boolean().optional(),
    morningBrief: z.boolean().optional(),
    morningBriefTime: hhmmSchema.optional(),
    meetingPrep: z.boolean().optional(),
    weeklyObserve: z.boolean().optional(),
    agentErrand: z.boolean().optional(),
    scheduleSuggest: z.boolean().optional(),
    workHoursStart: hhmmSchema.optional(),
    workHoursEnd: hhmmSchema.optional(),
    scheduleDayCapMinutes: z.number().int().min(30).max(1440).optional(),
    quietHoursStart: hhmmSchema.nullable().optional(),
    quietHoursEnd: hhmmSchema.nullable().optional(),
    allDayNotifyTime: hhmmSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  })
  .refine(
    (value) => {
      const start = value.quietHoursStart;
      const end = value.quietHoursEnd;
      if (start === undefined && end === undefined) return true;
      if (start === null && end === null) return true;
      if (typeof start === 'string' && typeof end === 'string') return true;
      if (start === undefined || end === undefined) return true;
      return false;
    },
    { message: 'quiet hours start and end must both be set or both be null' },
  );
export type PatchNotificationPrefs = z.infer<typeof patchNotificationPrefsSchema>;

export const notificationChannelTypeSchema = z.enum(['meow']);
export type NotificationChannelType = z.infer<typeof notificationChannelTypeSchema>;

export const meowNicknameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[^/\s]+$/, 'MEOW_NICKNAME_INVALID');

export const meowChannelConfigSchema = z.object({
  nickname: meowNicknameSchema,
});
export type MeowChannelConfig = z.infer<typeof meowChannelConfigSchema>;

export const notificationChannelConfigSchema = meowChannelConfigSchema;
export type NotificationChannelConfig = MeowChannelConfig;

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  enabled: boolean;
  config: NotificationChannelConfig;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationChannelCollection {
  items: NotificationChannel[];
}

export const createNotificationChannelInputSchema = z.object({
  type: notificationChannelTypeSchema,
  enabled: z.boolean().optional(),
  config: notificationChannelConfigSchema,
});
export type CreateNotificationChannelInput = z.infer<typeof createNotificationChannelInputSchema>;

export const patchNotificationChannelInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    config: notificationChannelConfigSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type PatchNotificationChannelInput = z.infer<typeof patchNotificationChannelInputSchema>;

export const notificationChannelIdParamsSchema = z.object({ id: uuidSchema });

export const pushProviderSchema = z.enum(['huawei']);
export type PushProvider = z.infer<typeof pushProviderSchema>;

export const registerPushDeviceInputSchema = z.object({
  provider: pushProviderSchema,
  token: z.string().trim().min(1).max(512),
});
export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceInputSchema>;

export interface PushDevice {
  id: string;
  provider: PushProvider;
}
