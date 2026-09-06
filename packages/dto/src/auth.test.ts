import { describe, expect, it } from 'vitest';
import {
  changePasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  updateMeInputSchema,
  updateOnboardingInputSchema,
} from './auth.js';

describe('registerInputSchema', () => {
  it('normalizes email (trim + lowercase)', () => {
    const input = registerInputSchema.parse({
      email: '  Alice@Example.COM ',
      password: 'secret123',
      displayName: 'Alice',
    });
    expect(input.email).toBe('alice@example.com');
  });

  it('rejects invalid email, short password, empty displayName, password > 128', () => {
    expect(() =>
      registerInputSchema.parse({ email: 'not-an-email', password: 'secret123', displayName: 'A' }),
    ).toThrow();
    expect(() =>
      registerInputSchema.parse({ email: 'a@b.com', password: 'short', displayName: 'A' }),
    ).toThrow();
    expect(() =>
      registerInputSchema.parse({ email: 'a@b.com', password: 'secret123', displayName: '' }),
    ).toThrow();
    expect(() =>
      registerInputSchema.parse({
        email: 'a@b.com',
        password: 'a'.repeat(129),
        displayName: 'A',
      }),
    ).toThrow();
  });

  it('accepts 128-char password', () => {
    const input = registerInputSchema.parse({
      email: 'a@b.com',
      password: 'a'.repeat(128),
      displayName: 'A',
    });
    expect(input.password).toHaveLength(128);
  });
});

describe('loginInputSchema', () => {
  it('normalizes email', () => {
    const input = loginInputSchema.parse({ email: 'Bob@Example.com', password: 'x' });
    expect(input.email).toBe('bob@example.com');
  });
});

describe('changePasswordInputSchema', () => {
  it('new password matches register rules (8–128)', () => {
    const ok = changePasswordInputSchema.parse({ oldPassword: 'x', newPassword: 'new-secret-1' });
    expect(ok.newPassword).toBe('new-secret-1');
    expect(() =>
      changePasswordInputSchema.parse({ oldPassword: '', newPassword: 'new-secret-1' }),
    ).toThrow();
    expect(() =>
      changePasswordInputSchema.parse({ oldPassword: 'x', newPassword: 'short' }),
    ).toThrow();
    expect(() =>
      changePasswordInputSchema.parse({ oldPassword: 'x', newPassword: 'a'.repeat(129) }),
    ).toThrow();
  });
});

describe('updateMeInputSchema', () => {
  it('rejects empty patch; accepts IANA timezone and theme', () => {
    expect(() => updateMeInputSchema.parse({})).toThrow();
    const ok = updateMeInputSchema.parse({
      displayName: 'Ada',
      timezone: 'Asia/Shanghai',
      themePreference: 'dark',
      weekStartsOn: 0,
      convertArchiveOnComplete: true,
    });
    expect(ok.displayName).toBe('Ada');
    expect(ok.weekStartsOn).toBe(0);
    expect(() => updateMeInputSchema.parse({ timezone: 'Not/AZone' })).toThrow();
  });
});

describe('updateOnboardingInputSchema', () => {
  it('rejects empty; merges flags', () => {
    expect(() => updateOnboardingInputSchema.parse({})).toThrow();
    const ok = updateOnboardingInputSchema.parse({ dismissed: true });
    expect(ok.dismissed).toBe(true);
  });

  it('accepts activation checklist flags and omits unset keys', () => {
    const ok = updateOnboardingInputSchema.parse({
      completedTask: true,
      openedWeekly: true,
      pinnedTask: true,
    });
    expect(ok.completedTask).toBe(true);
    expect(ok.openedWeekly).toBe(true);
    expect(ok.pinnedTask).toBe(true);
    expect(ok.createdTask).toBeUndefined();
    expect(ok.dismissed).toBeUndefined();
  });
});
