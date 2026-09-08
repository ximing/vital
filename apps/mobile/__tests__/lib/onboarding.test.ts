import { describe, expect, it } from 'vitest';
import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { needsOnboarding, showChecklist } from '../../src/lib/onboarding-state';

const user: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: {},
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('mobile onboarding helpers', () => {
  it('requires the wizard until skip or a checklist flag', () => {
    expect(needsOnboarding(user)).toBe(true);
    expect(needsOnboarding({ ...user, onboarding: { dismissed: true } })).toBe(false);
    expect(needsOnboarding({ ...user, onboarding: { createdTask: true } })).toBe(false);
    expect(showChecklist({})).toBe(true);
    expect(showChecklist({ dismissed: true })).toBe(false);
  });
});
