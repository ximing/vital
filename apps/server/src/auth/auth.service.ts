import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DEFAULT_NOTIFICATION_PREFS,
  hhmmSchema,
  onboardingStateSchema,
  themePreferenceSchema,
  weekStartsOnSchema,
  type AuthMode,
  type AuthResponse,
  type ChangePasswordInput,
  type ExtensionAuthCodeResponse,
  type LoginInput,
  type NotificationPrefs,
  type OnboardingState,
  type RegisterInput,
  type UpdateMeInput,
  type UpdateOnboardingInput,
  type UserProfile,
} from '@vital/dto';
import { and, eq, isNull } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { extensionAuthCodes, lists, users, type User } from '../db/schema.js';
import { AppError } from '../errors.js';
import { inboxListValues } from '../lists/lists.service.js';
import { logger } from '../utils/logger.js';
import { hashPassword, verifyPassword } from './password.js';
import { issueRefreshToken, revokeAllForUser, signAccessToken } from './token.service.js';

function onboardingOf(value: unknown): OnboardingState {
  const parsed = onboardingStateSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function themeOf(value: string): UserProfile['themePreference'] {
  const parsed = themePreferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : 'system';
}

function weekStartsOnOf(value: number): UserProfile['weekStartsOn'] {
  const parsed = weekStartsOnSchema.safeParse(value);
  return parsed.success ? parsed.data : 1;
}

function hhmmOrNull(value: string | null): string | null {
  if (value === null) return null;
  const parsed = hhmmSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function notificationsOf(user: User): NotificationPrefs {
  const allDay = hhmmSchema.safeParse(user.allDayNotifyTime);
  return {
    taskRemind: user.notifyTaskRemind,
    taskDue: user.notifyTaskDue,
    quietHoursStart: hhmmOrNull(user.quietHoursStart),
    quietHoursEnd: hhmmOrNull(user.quietHoursEnd),
    allDayNotifyTime: allDay.success ? allDay.data : DEFAULT_NOTIFICATION_PREFS.allDayNotifyTime,
  };
}

export function toProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarAttachmentId: user.avatarAttachmentId,
    timezone: user.timezone,
    locale: user.locale,
    themePreference: themeOf(user.themePreference),
    weekStartsOn: weekStartsOnOf(user.weekStartsOn),
    convertArchiveOnComplete: user.convertArchiveOnComplete,
    notifications: notificationsOf(user),
    onboarding: onboardingOf(user.onboarding),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function tokensFor(
  accessToken: string,
  refreshToken: string,
  mode: AuthMode,
): AuthResponse['tokens'] {
  if (mode === 'cookie') {
    return { accessToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
  }
  return { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
}

export async function getUserEntity(userId: string): Promise<User> {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw AppError.of(404, 'NOT_FOUND');
  return user;
}

export async function getProfile(userId: string): Promise<UserProfile> {
  return toProfile(await getUserEntity(userId));
}

async function buildAuthResponse(
  user: User,
  mode: AuthMode,
  deviceInfo?: string,
): Promise<{ response: AuthResponse; refreshToken: string }> {
  const refreshToken = await issueRefreshToken(user.id, mode, deviceInfo);
  const accessToken = signAccessToken(user.id);
  return {
    response: { user: toProfile(user), tokens: tokensFor(accessToken, refreshToken, mode) },
    refreshToken,
  };
}

export async function registerUser(
  input: RegisterInput,
  mode: AuthMode,
  deviceInfo?: string,
): Promise<{ response: AuthResponse; refreshToken: string }> {
  const [existing] = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (existing) throw AppError.of(409, 'EMAIL_ALREADY_REGISTERED');

  const now = new Date();
  const user: User = {
    id: randomUUID(),
    email: input.email,
    passwordHash: await hashPassword(input.password),
    displayName: input.displayName,
    avatarAttachmentId: null,
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN',
    themePreference: 'system',
    weekStartsOn: 1,
    convertArchiveOnComplete: false,
    notifyTaskRemind: true,
    notifyTaskDue: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    allDayNotifyTime: '09:00',
    onboarding: {},
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(users).values(user);
      await tx.insert(lists).values(inboxListValues(user.id, now));
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.of(409, 'EMAIL_ALREADY_REGISTERED');
    throw err;
  }
  return buildAuthResponse(user, mode, deviceInfo);
}

export async function loginUser(
  input: LoginInput,
  mode: AuthMode,
  deviceInfo?: string,
): Promise<{ response: AuthResponse; refreshToken: string }> {
  const [user] = await getDb().select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    logger.info('auth.login.fail', { email: input.email });
    throw AppError.of(401, 'INVALID_CREDENTIALS');
  }
  logger.info('auth.login.ok', { userId: user.id });
  return buildAuthResponse(user, mode, deviceInfo);
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await getUserEntity(userId);
  if (!(await verifyPassword(input.oldPassword, user.passwordHash))) {
    throw AppError.of(400, 'INVALID_OLD_PASSWORD');
  }
  const passwordHash = await hashPassword(input.newPassword);
  const changedAt = new Date();
  await getDb().transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: changedAt,
        updatedAt: changedAt,
      })
      .where(eq(users.id, user.id));
    await revokeAllForUser(userId, tx);
  });
}

export async function updateMe(userId: string, input: UpdateMeInput): Promise<UserProfile> {
  const patch: Partial<User> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.avatarAttachmentId !== undefined) patch.avatarAttachmentId = input.avatarAttachmentId;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.themePreference !== undefined) patch.themePreference = input.themePreference;
  if (input.weekStartsOn !== undefined) patch.weekStartsOn = input.weekStartsOn;
  if (input.convertArchiveOnComplete !== undefined) {
    patch.convertArchiveOnComplete = input.convertArchiveOnComplete;
  }
  if (input.notifications !== undefined) {
    const current = await getUserEntity(userId);
    const nextStart =
      input.notifications.quietHoursStart !== undefined
        ? input.notifications.quietHoursStart
        : current.quietHoursStart;
    const nextEnd =
      input.notifications.quietHoursEnd !== undefined
        ? input.notifications.quietHoursEnd
        : current.quietHoursEnd;
    if ((nextStart === null) !== (nextEnd === null)) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    if (input.notifications.taskRemind !== undefined) {
      patch.notifyTaskRemind = input.notifications.taskRemind;
    }
    if (input.notifications.taskDue !== undefined) {
      patch.notifyTaskDue = input.notifications.taskDue;
    }
    if (input.notifications.quietHoursStart !== undefined) patch.quietHoursStart = nextStart;
    if (input.notifications.quietHoursEnd !== undefined) patch.quietHoursEnd = nextEnd;
    if (input.notifications.allDayNotifyTime !== undefined) {
      patch.allDayNotifyTime = input.notifications.allDayNotifyTime;
    }
  }
  await getDb().update(users).set(patch).where(eq(users.id, userId));
  return getProfile(userId);
}

const EXTENSION_CODE_TTL_SECONDS = 120;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function createExtensionAuthCode(userId: string): Promise<ExtensionAuthCodeResponse> {
  await getUserEntity(userId);
  const code = randomBytes(32).toString('base64url');
  const now = new Date();
  await getDb()
    .insert(extensionAuthCodes)
    .values({
      id: randomUUID(),
      userId,
      codeHash: sha256(code),
      expiresAt: new Date(now.getTime() + EXTENSION_CODE_TTL_SECONDS * 1000),
      usedAt: null,
      createdAt: now,
    });
  return { code, expiresIn: EXTENSION_CODE_TTL_SECONDS };
}

export async function exchangeExtensionAuthCode(
  code: string,
  deviceInfo?: string,
): Promise<{ response: AuthResponse; refreshToken: string }> {
  const hash = sha256(code);
  const now = new Date();
  const claimed = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(extensionAuthCodes)
      .where(eq(extensionAuthCodes.codeHash, hash))
      .limit(1);
    if (!row || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
      throw AppError.of(400, 'AUTH_CODE_INVALID');
    }
    const updated = await tx
      .update(extensionAuthCodes)
      .set({ usedAt: now })
      .where(and(eq(extensionAuthCodes.id, row.id), isNull(extensionAuthCodes.usedAt)))
      .returning({ userId: extensionAuthCodes.userId });
    const claimedRow = updated[0];
    if (!claimedRow) throw AppError.of(400, 'AUTH_CODE_INVALID');
    return claimedRow;
  });
  const user = await getUserEntity(claimed.userId);
  return buildAuthResponse(user, 'bearer', deviceInfo ?? 'chrome-extension');
}

export async function updateOnboarding(
  userId: string,
  input: UpdateOnboardingInput,
): Promise<UserProfile> {
  const user = await getUserEntity(userId);
  const next: OnboardingState = { ...onboardingOf(user.onboarding), ...input };
  await getDb()
    .update(users)
    .set({ onboarding: next, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return getProfile(userId);
}
