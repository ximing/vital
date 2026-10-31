import type { CalendarInstance } from '@vital/dto';
import type { ScheduleOccurrence } from './place';

export function toScheduleOccurrence(item: CalendarInstance): ScheduleOccurrence {
  return {
    taskId: item.taskId,
    title: item.title,
    occurrenceAt: item.occurrenceAt,
    endsAt: item.endsAt,
    isAllDay: item.isAllDay,
    habit: item.habitId !== null && item.habitId !== '',
    locked: item.calendarKey !== null && item.calendarKey !== '',
  };
}
