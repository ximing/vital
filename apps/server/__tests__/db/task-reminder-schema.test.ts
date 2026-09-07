import { describe, expect, it } from 'vitest';
import { holidayCalendar, tasks } from '../../src/db/schema.js';

describe('task reminder recurrence schema', () => {
  it('exposes semantic task fields and a versioned China calendar table', () => {
    expect(tasks.reminderMode.name).toBe('reminder_mode');
    expect(tasks.reminderOffsetMinutes.name).toBe('reminder_offset_minutes');
    expect(tasks.reminderAt.name).toBe('reminder_at');
    expect(tasks.recurrenceKind.name).toBe('recurrence_kind');
    expect(holidayCalendar.region.name).toBe('region');
    expect(holidayCalendar.sourceVersion.name).toBe('source_version');
  });
});
