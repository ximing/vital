import { z } from 'zod';
import { patchNotificationPrefsSchema, type NotificationPrefs } from './notifications.js';
import type { LlmSettingsPublic } from './llm.js';

const emailSchema = z.string().trim().toLowerCase().email().max(255);

export const passwordSchema = z.string().min(8).max(128);

export const ianaTimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'INVALID_TIMEZONE' },
  );

export const themePreferenceSchema = z.enum(['light', 'dark', 'system']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export const weekStartsOnSchema = z.union([z.literal(0), z.literal(1)]);
export type WeekStartsOn = z.infer<typeof weekStartsOnSchema>;

export const authModeSchema = z.enum(['cookie', 'bearer']);
export type AuthMode = z.infer<typeof authModeSchema>;

export const onboardingStateSchema = z.object({
  createdTask: z.boolean().optional(),
  capturedInbox: z.boolean().optional(),
  wroteDaily: z.boolean().optional(),
  completedTask: z.boolean().optional(),
  openedWeekly: z.boolean().optional(),
  pinnedTask: z.boolean().optional(),
  dismissed: z.boolean().optional(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const ONBOARDING_CHECKLIST_KEYS = [
  'createdTask',
  'completedTask',
  'capturedInbox',
  'openedWeekly',
  'pinnedTask',
] as const satisfies readonly (keyof OnboardingState)[];
export type OnboardingChecklistKey = (typeof ONBOARDING_CHECKLIST_KEYS)[number];

export const registerInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(50),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof refreshInputSchema>;

export const changePasswordInputSchema = z.object({
  oldPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export type LlmJsonValue =
  string | number | boolean | null | LlmJsonValue[] | { [key: string]: LlmJsonValue };
export type LlmParameters = Record<string, LlmJsonValue>;

const llmJsonValueSchema: z.ZodType<LlmJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(llmJsonValueSchema),
    z.record(llmJsonValueSchema),
  ]),
);

// These fields belong to the application or transport, not model tuning.
const reservedLlmParameters = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'response_format',
  'n',
  'tools',
  'tool_choice',
  'functions',
  'function_call',
  'api_key',
  'apiKey',
  'apiBase',
  'base_url',
  'headers',
  'authorization',
  '__proto__',
  'constructor',
  'prototype',
]);

export const llmParametersSchema = z.record(llmJsonValueSchema).superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 16_384) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '参数不能超过 16 KB' });
  }
  for (const key of Object.keys(value)) {
    if (reservedLlmParameters.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: '此字段由应用管理，不能在模型参数中设置',
      });
    }
  }
  const known = z
    .object({
      thinking: z
        .object({ type: z.enum(['enabled', 'disabled']) })
        .passthrough()
        .optional(),
      reasoning_effort: z.string().trim().min(1).max(64).optional(),
      max_tokens: z.number().int().positive().optional(),
      max_completion_tokens: z.number().int().positive().optional(),
      temperature: z.number().finite().min(0).max(2).optional(),
      top_p: z.number().finite().min(0).max(1).optional(),
    })
    .safeParse(value);
  if (!known.success) for (const issue of known.error.issues) ctx.addIssue(issue);
  if (value.max_tokens !== undefined && value.max_completion_tokens !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'max_tokens 和 max_completion_tokens 只能设置一个',
    });
  }
});

/** Shared by web and mobile; an empty editor resets provider parameters. */
export function parseLlmParameters(raw: string): LlmParameters {
  if (raw.trim() === '') return {};
  if (raw.length > 16_384) throw new Error('模型参数不能超过 16 KB');
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('模型参数必须是有效的 JSON 对象');
  }
  const result = llmParametersSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`模型参数无效：${issue?.path.join('.') || 'JSON'} ${issue?.message ?? ''}`);
  }
  return result.data;
}

export const updateMeInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    avatarAttachmentId: z.string().uuid().nullable().optional(),
    timezone: ianaTimezoneSchema.optional(),
    locale: z.string().min(2).max(16).optional(),
    themePreference: themePreferenceSchema.optional(),
    weekStartsOn: weekStartsOnSchema.optional(),
    convertArchiveOnComplete: z.boolean().optional(),
    notifications: patchNotificationPrefsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one field required',
  });
export type UpdateMeInput = z.infer<typeof updateMeInputSchema>;

export const updateOnboardingInputSchema = onboardingStateSchema.refine(
  (value) => Object.values(value).some((item) => item !== undefined),
  { message: 'at least one field required' },
);
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingInputSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarAttachmentId?: string | null;
  /** Private S3 URL, signed by the server for six hours. */
  avatarUrl?: string | null;
  timezone: string;
  locale: string;
  themePreference: ThemePreference;
  weekStartsOn: WeekStartsOn;
  convertArchiveOnComplete: boolean;
  notifications: NotificationPrefs;
  onboarding: OnboardingState;
  llm: LlmSettingsPublic;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: UserProfile;
  tokens: AuthTokens;
}

/** Chrome MV3 IDs are 32 chars in a–p. */
export const chromeExtensionIdSchema = z
  .string()
  .length(32)
  .regex(/^[a-p]{32}$/);
export type ChromeExtensionId = z.infer<typeof chromeExtensionIdSchema>;

export const exchangeExtensionAuthInputSchema = z.object({
  code: z.string().min(20).max(128),
});
export type ExchangeExtensionAuthInput = z.infer<typeof exchangeExtensionAuthInputSchema>;

export const extensionAuthCodeResponseSchema = z.object({
  code: z.string().min(20).max(128),
  expiresIn: z.number().int().positive(),
});
export type ExtensionAuthCodeResponse = z.infer<typeof extensionAuthCodeResponseSchema>;
