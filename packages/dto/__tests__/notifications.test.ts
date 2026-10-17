import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  createNotificationChannelInputSchema,
  hhmmSchema,
  meowNicknameSchema,
  patchNotificationChannelInputSchema,
  patchNotificationPrefsSchema,
} from '../src/notifications.js';

describe('hhmmSchema', () => {
  it('accepts 00:00–23:59', () => {
    expect(hhmmSchema.parse('09:00')).toBe('09:00');
    expect(hhmmSchema.parse('23:59')).toBe('23:59');
    expect(hhmmSchema.parse('00:00')).toBe('00:00');
    expect(() => hhmmSchema.parse('24:00')).toThrow();
    expect(() => hhmmSchema.parse('9:00')).toThrow();
  });
});

describe('meowNicknameSchema', () => {
  it('trims and rejects slash or whitespace', () => {
    expect(meowNicknameSchema.parse('  席铭  ')).toBe('席铭');
    expect(() => meowNicknameSchema.parse('a/b')).toThrow();
    expect(() => meowNicknameSchema.parse('a b')).toThrow();
    expect(() => meowNicknameSchema.parse('')).toThrow();
  });
});

describe('patchNotificationPrefsSchema', () => {
  it('defaults proactive reminders on and accepts opting out', () => {
    expect(DEFAULT_NOTIFICATION_PREFS.agentInsights).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.meetingPrep).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.weeklyObserve).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.agentErrand).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.scheduleSuggest).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.workHoursStart).toBe('09:00');
    expect(DEFAULT_NOTIFICATION_PREFS.workHoursEnd).toBe('18:00');
    expect(DEFAULT_NOTIFICATION_PREFS.scheduleDayCapMinutes).toBe(540);
    expect(patchNotificationPrefsSchema.parse({ scheduleSuggest: false })).toEqual({ scheduleSuggest: false });
    expect(patchNotificationPrefsSchema.parse({ meetingPrep: false })).toEqual({ meetingPrep: false });
    expect(patchNotificationPrefsSchema.parse({ weeklyObserve: false })).toEqual({ weeklyObserve: false });
    expect(patchNotificationPrefsSchema.parse({ agentErrand: false })).toEqual({ agentErrand: false });
    expect(patchNotificationPrefsSchema.parse({ agentInsights: false })).toEqual({ agentInsights: false });
    expect(patchNotificationPrefsSchema.parse({ morningBrief: false, morningBriefTime: '07:30' })).toEqual({
      morningBrief: false,
      morningBriefTime: '07:30',
    });
    expect(() => patchNotificationPrefsSchema.parse({ morningBriefTime: '25:00' })).toThrow();
  });

  it('requires both quiet hours or both null', () => {
    expect(patchNotificationPrefsSchema.parse({ taskRemind: false }).taskRemind).toBe(false);
    expect(
      patchNotificationPrefsSchema.parse({ quietHoursStart: null, quietHoursEnd: null }),
    ).toEqual({ quietHoursStart: null, quietHoursEnd: null });
    expect(
      patchNotificationPrefsSchema.parse({
        quietHoursStart: '23:00',
        quietHoursEnd: '08:00',
      }),
    ).toMatchObject({ quietHoursStart: '23:00', quietHoursEnd: '08:00' });
    expect(() =>
      patchNotificationPrefsSchema.parse({ quietHoursStart: '23:00', quietHoursEnd: null }),
    ).toThrow();
    expect(() => patchNotificationPrefsSchema.parse({})).toThrow();
  });
});

describe('channel input', () => {
  it('parses meow create and patch', () => {
    const created = createNotificationChannelInputSchema.parse({
      type: 'meow',
      config: { nickname: 'JohnDoe' },
    });
    expect(created.config.nickname).toBe('JohnDoe');
    expect(() => createNotificationChannelInputSchema.parse({ type: 'bark', config: {} })).toThrow();
    expect(patchNotificationChannelInputSchema.parse({ enabled: false }).enabled).toBe(false);
    expect(() => patchNotificationChannelInputSchema.parse({})).toThrow();
  });
});
