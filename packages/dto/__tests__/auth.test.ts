import { describe, expect, it } from 'vitest';
import {
  changePasswordInputSchema,
  chromeExtensionIdSchema,
  exchangeExtensionAuthInputSchema,
  loginInputSchema,
  registerInputSchema,
  updateMeInputSchema,
  updateOnboardingInputSchema,
} from '../src/auth.js';
import { llmRoutingSchema } from '../src/llm.js';

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

  it('accepts a 32-char chrome extension id and rejects others', () => {
    expect(chromeExtensionIdSchema.parse('abcdefghijklmnopabcdefghijklmnop')).toBe(
      'abcdefghijklmnopabcdefghijklmnop',
    );
    expect(chromeExtensionIdSchema.safeParse('not-an-id').success).toBe(false);
    expect(chromeExtensionIdSchema.safeParse('q'.repeat(32)).success).toBe(false);
  });

  it('requires a long one-time extension auth code', () => {
    expect(exchangeExtensionAuthInputSchema.parse({ code: 'a'.repeat(32) }).code).toBe(
      'a'.repeat(32),
    );
    expect(exchangeExtensionAuthInputSchema.safeParse({ code: 'short' }).success).toBe(false);
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
  it('preserves generic nested model parameters on routing targets and rejects bad ones', () => {
    const parameters = {
      thinking: { type: 'enabled', clear_thinking: false },
      reasoning_effort: 'future-effort',
      max_tokens: 4096,
      custom: { values: [true, 1, null] },
    };
    const ok = llmRoutingSchema.parse({
      'agent.headline': { providerId: 'p1', model: 'm1', parameters },
    });
    expect(ok['agent.headline']?.parameters).toEqual(parameters);
  });

  it.each([
    [],
    'invalid',
    { max_tokens: 0 },
    { max_tokens: 1.5 },
    { thinking: { type: 'invalid' } },
    { reasoning_effort: '' },
    { model: 'override' },
    { messages: [] },
    { stream: true },
    { response_format: { type: 'text' } },
    { api_key: 'secret' },
    { n: 2 },
    { custom: 'x'.repeat(17000) },
  ])('rejects invalid or reserved model parameters: %j', (parameters) => {
    expect(
      llmRoutingSchema.safeParse({ default: { providerId: 'p1', model: 'm1', parameters } })
        .success,
    ).toBe(false);
  });

  it('rejects empty patch; accepts IANA timezone and theme', () => {
    expect(() => updateMeInputSchema.parse({})).toThrow();
    const ok = updateMeInputSchema.parse({
      displayName: 'Ada',
      timezone: 'Asia/Shanghai',
      themePreference: 'dark',
      weekStartsOn: 0,
      convertArchiveOnComplete: true,
      notifications: { taskRemind: false },
    });
    expect(ok.notifications?.taskRemind).toBe(false);
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
