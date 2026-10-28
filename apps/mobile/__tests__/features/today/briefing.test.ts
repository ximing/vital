import { describe, expect, it } from 'vitest';
import {
  clothingSuggestion,
  describeTodayLayoutFacts,
  nearestStatutoryHoliday,
  normalizeCalendarEvent,
  normalizeTodayLayout,
  calendarQueryWindow,
  eventOverlapsDay,
  groupTodayModuleRows,
  localDayBounds,
  todayModulesOrFallback,
  upcomingExcludingToday,
} from '../../../src/features/today/briefing-core';

const TZ = 'Asia/Shanghai';

describe('today briefing helpers', () => {
  it('suggests light clothes in hot dry weather, outerwear when cold, and rain protection when wet', () => {
    expect(clothingSuggestion({ temperatureC: 33, weatherCode: 0 })).toBe('hot-dry');
    expect(clothingSuggestion({ temperatureC: 2, weatherCode: 1 })).toBe('cold');
    expect(clothingSuggestion({ temperatureC: 18, weatherCode: 61 })).toBe('rain');
    expect(clothingSuggestion({ temperatureC: -1, weatherCode: 71 })).toBe('snow');
  });

  it('picks the nearest statutory holiday before, on, and after 国庆节, rolling to 元旦', () => {
    expect(nearestStatutoryHoliday('2026-09-30')).toEqual({ name: '国庆节', date: '2026-10-01' });
    expect(nearestStatutoryHoliday('2026-10-01')).toEqual({ name: '国庆节', date: '2026-10-01' });
    expect(nearestStatutoryHoliday('2026-10-02')).toEqual({ name: '元旦', date: '2027-01-01' });
  });

  it('keeps a tomorrow item and drops a today item from the upcoming window', () => {
    const today = {
      id: 'today',
      title: '今天写周报',
      status: 'todo',
      dueAt: '2026-10-13T00:00:00+08:00',
      startAt: null,
    };
    const tomorrow = {
      id: 'tomorrow',
      title: '明天交报告',
      status: 'todo',
      dueAt: '2026-10-14T00:00:00+08:00',
      startAt: null,
    };
    const tooFar = {
      id: 'far',
      title: '八天后',
      status: 'todo',
      dueAt: '2026-10-21T00:00:00+08:00',
      startAt: null,
    };
    expect(upcomingExcludingToday([today, tomorrow, tooFar], '2026-10-13', TZ).map((task) => task.title)).toEqual([
      '明天交报告',
    ]);
  });

  it('bounds the account-local day, including Shanghai and a daylight-saving change', () => {
    const shanghai = localDayBounds(TZ, new Date('2026-10-13T04:00:00.000Z'));
    expect(shanghai.start.toISOString()).toBe('2026-10-12T16:00:00.000Z');
    expect(shanghai.end.toISOString()).toBe('2026-10-13T16:00:00.000Z');
    const query = calendarQueryWindow(shanghai);
    expect(query.start.toISOString()).toBe('2026-09-12T16:00:00.000Z');
    expect(query.end.toISOString()).toBe('2026-10-20T16:00:00.000Z');
    const fallBack = localDayBounds('America/New_York', new Date('2026-11-01T12:00:00.000Z'));
    expect(fallBack.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(fallBack.end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('keeps an event that overlaps local today and drops one that starts at the next midnight', () => {
    const start = new Date('2026-10-12T16:00:00.000Z');
    const end = new Date('2026-10-13T16:00:00.000Z');
    expect(eventOverlapsDay('2026-10-13T14:00:00.000Z', '2026-10-13T16:30:00.000Z', start, end)).toBe(true);
    expect(eventOverlapsDay('2026-10-12T02:00:00.000Z', '2026-10-13T02:00:00.000Z', start, end)).toBe(true);
    expect(eventOverlapsDay('2026-10-13T16:00:00.000Z', '2026-10-13T17:00:00.000Z', start, end)).toBe(false);
  });

  it('keeps title, local start, and all-day from a calendar payload', () => {
    expect(
      normalizeCalendarEvent(
        { title: '周会', start: '2026-10-13T01:30:00.000Z', allDay: false },
        TZ,
      ),
    ).toEqual({ title: '周会', start: '09:30', allDay: false });
    expect(
      normalizeCalendarEvent({ title: '出差', start: '2026-10-13T00:00:00+08:00', allDay: true }, TZ),
    ).toEqual({ title: '出差', start: '2026-10-13', allDay: true });
  });

  it('keeps a usable module list and describes the facts a layout agent can see', () => {
    expect(
      normalizeTodayLayout([
        { id: 'weather' },
        { id: 'nope' },
        { id: 'meetings' },
        { id: 'weather' },
        { id: 'note', text: '   ' },
        { id: 'note', text: '先处理逾期' },
      ]),
    ).toEqual([
      { id: 'weather' },
      { id: 'note', text: '先处理逾期' },
    ]);
    expect(todayModulesOrFallback(null).map((item) => item.id)).toEqual([
      'lead',
      'weather',
      'upcoming',
      'holiday',
      'focus',
    ]);
    const text = describeTodayLayoutFacts({
      timezone: 'Asia/Shanghai',
      localNow: '2026-10-13 12:00',
      openTasks: [{ title: '完成项目整理', due: null, overdue: true }],
      upcoming: [],
      holidayName: '元旦',
      holidayDate: '2027-01-01',
      weather: '上海 晴 33°C 短袖即可，注意防晒',
      recommendations: [],
      quiet: false,
      habits: [],
      memory: [],
    });
    expect(text).toContain('完成项目整理');
    expect(text).toContain('已逾期');
    expect(text).toContain('元旦');
    expect(text).toContain('上海 晴');
    expect(text).not.toContain('日程');
  });

  it('keeps the agenda together and the lead and focus on their own rows', () => {
    const modules = [
      { id: 'lead' },
      { id: 'weather' },
      { id: 'upcoming' },
      { id: 'holiday' },
      { id: 'focus' },
    ];
    expect(groupTodayModuleRows(modules, 2).map((row) => row.map((module) => module.id))).toEqual([
      ['lead'],
      ['weather'],
      ['upcoming'],
      ['holiday'],
      ['focus'],
    ]);
    expect(groupTodayModuleRows([{ id: 'holiday' }, { id: 'lead' }, { id: 'note', text: '先收逾期' }], 2)).toEqual([
      [{ id: 'holiday' }],
      [{ id: 'lead' }],
      [{ id: 'note', text: '先收逾期' }],
    ]);
    expect(groupTodayModuleRows(modules, 1).map((row) => row.map((module) => module.id))).toEqual([
      ['lead'],
      ['weather'],
      ['upcoming'],
      ['holiday'],
      ['focus'],
    ]);
  });
});
