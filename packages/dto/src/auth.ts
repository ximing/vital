import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email().max(255);

export const passwordSchema = z.string().min(8).max(128);

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
  dismissed: z.boolean().optional(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

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

export const updateMeInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    timezone: z
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
      )
      .optional(),
    locale: z.string().min(2).max(16).optional(),
    themePreference: themePreferenceSchema.optional(),
    weekStartsOn: weekStartsOnSchema.optional(),
    convertArchiveOnComplete: z.boolean().optional(),
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
  timezone: string;
  locale: string;
  themePreference: ThemePreference;
  weekStartsOn: WeekStartsOn;
  convertArchiveOnComplete: boolean;
  onboarding: OnboardingState;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: UserProfile;
  tokens: AuthTokens;
}
