import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  isSlotMinute,
  scheduleGestureRange,
  type DayCell,
  type HourCell,
  type ScheduleCreateRange,
} from './gesture';

function asElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Text) return target.parentElement;
  return null;
}

/** Cell under the pointer, read from the grid's data attributes. */
export function scheduleCellFromEventTarget(target: EventTarget | null): HourCell | DayCell | null {
  const element = asElement(target);
  if (element === null) return null;
  const hour = element.closest<HTMLElement>('[data-schedule-day][data-schedule-hour]');
  if (hour !== null) {
    const ymd = hour.dataset.scheduleDay;
    const value = Number(hour.dataset.scheduleHour);
    const minute = Number(hour.dataset.scheduleMinute);
    if (
      ymd !== undefined &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 23 &&
      isSlotMinute(minute)
    ) {
      return { kind: 'hour', ymd, hour: value, minute };
    }
    return null;
  }
  const allDay = element.closest<HTMLElement>('[data-schedule-all-day]');
  if (allDay?.dataset.scheduleAllDay) {
    return { kind: 'day', ymd: allDay.dataset.scheduleAllDay };
  }
  const date = element.closest<HTMLElement>('[data-schedule-date]');
  if (date?.dataset.scheduleDate) {
    return { kind: 'day', ymd: date.dataset.scheduleDate };
  }
  return null;
}

export function schedulePointerOnItem(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (element === null) return false;
  return element.closest('[data-schedule-title]') !== null;
}

/**
 * Press on an empty cell, drag across sibling cells, release to commit.
 * Listeners sit on window so the release still counts after the pointer
 * leaves the cell that received the press. Layout size is never read.
 */
export function useScheduleGesture(
  timeZone: string,
  blocked: boolean,
  onCommit: (range: ScheduleCreateRange) => void,
): {
  preview: ScheduleCreateRange | null;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const anchorRef = useRef<HourCell | DayCell | null>(null);
  const focusRef = useRef<HourCell | DayCell | null>(null);
  const [preview, setPreview] = useState<ScheduleCreateRange | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    function focusFrom(target: EventTarget | null): void {
      const anchor = anchorRef.current;
      if (anchor === null) return;
      const point = scheduleCellFromEventTarget(target);
      if (point === null || point.kind !== anchor.kind) return;
      focusRef.current = point;
      const range = scheduleGestureRange(anchor, point, timeZone);
      if (range) setPreview(range);
    }
    function finish(commit: boolean, target: EventTarget | null): void {
      const anchor = anchorRef.current;
      if (commit) focusFrom(target);
      const focus = focusRef.current;
      anchorRef.current = null;
      focusRef.current = null;
      setDragging(false);
      setPreview(null);
      if (!commit || anchor === null || focus === null) return;
      const range = scheduleGestureRange(anchor, focus, timeZone);
      if (range) onCommit(range);
    }
    function onMove(event: PointerEvent): void {
      focusFrom(event.target);
    }
    function onUp(event: PointerEvent): void {
      finish(true, event.target);
    }
    function onCancel(): void {
      finish(false, null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [dragging, onCommit, timeZone]);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    // Synthetic pointer events in tests omit `button`. A real primary press is 0.
    if (blocked || (event.button !== undefined && event.button !== 0)) return;
    if (schedulePointerOnItem(event.target)) return;
    const point = scheduleCellFromEventTarget(event.target);
    if (point === null) return;
    anchorRef.current = point;
    focusRef.current = point;
    const range = scheduleGestureRange(point, point, timeZone);
    setPreview(range);
    setDragging(true);
  }

  return { preview, onPointerDown };
}
