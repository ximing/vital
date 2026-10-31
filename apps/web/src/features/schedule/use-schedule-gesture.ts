import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  isSlotMinute,
  resizeTimedOccurrence,
  scheduleChangeHighlight,
  scheduleGestureRange,
  shiftAllDayOccurrence,
  shiftTimedByDays,
  shiftTimedOccurrence,
  type DayCell,
  type HourCell,
  type ScheduleCreateRange,
  type ScheduleTimeChange,
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

/** Cell under the pointer. A block sitting on top of the grid is skipped via the element stack. */
export function scheduleCellFromPointer(event: {
  target: EventTarget | null;
  clientX?: number;
  clientY?: number;
}): HourCell | DayCell | null {
  const direct = scheduleCellFromEventTarget(event.target);
  if (direct !== null) return direct;
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  const stack = document.elementsFromPoint(event.clientX ?? 0, event.clientY ?? 0);
  for (const element of stack) {
    const cell = scheduleCellFromEventTarget(element);
    if (cell !== null) return cell;
  }
  return null;
}

export function schedulePointerOnItem(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (element === null) return false;
  return (
    element.closest(
      '[data-schedule-title], [data-schedule-more], [data-schedule-day-link], [data-schedule-resize]',
    ) !== null
  );
}

type EditTarget = {
  taskId: string;
  startAt: string;
  dueAt: string;
  isAllDay: boolean;
  spanStartYmd: string;
  spanEndYmd: string;
  columnYmd: string;
  edge: 'start' | 'end' | null;
};

function readScheduleEdit(target: EventTarget | null): EditTarget | null {
  const element = asElement(target);
  if (element === null) return null;
  if (element.closest('[data-region="schedule-more"], [data-schedule-day-link]')) return null;
  const resize = element.closest<HTMLElement>('[data-schedule-resize]');
  const item = element.closest<HTMLElement>('[data-schedule-task]');
  if (item === null) return null;
  if (item.dataset.scheduleLocked === 'true') return null;
  if (resize === null && element.closest('[data-schedule-title]') === null) return null;
  const taskId = item.dataset.scheduleTask ?? '';
  const startAt = item.dataset.scheduleStart ?? '';
  const dueAt = item.dataset.scheduleDue ?? '';
  const spanStartYmd = item.dataset.scheduleSpanStart ?? '';
  const spanEndYmd = item.dataset.scheduleSpanEnd ?? '';
  const columnYmd = item.dataset.scheduleColumn || spanStartYmd;
  if (taskId === '' || startAt === '' || dueAt === '' || spanStartYmd === '' || spanEndYmd === '') {
    return null;
  }
  const edgeAttr = resize?.dataset.scheduleResize;
  const edge = edgeAttr === 'start' || edgeAttr === 'end' ? edgeAttr : null;
  const isAllDay = item.dataset.scheduleAllDayItem === 'true';
  if (edge !== null && isAllDay) return null;
  return { taskId, startAt, dueAt, isAllDay, spanStartYmd, spanEndYmd, columnYmd, edge };
}

type MoveSession = {
  kind: 'move';
  taskId: string;
  startAt: string;
  dueAt: string;
  isAllDay: boolean;
  spanStartYmd: string;
  spanEndYmd: string;
  origin: HourCell | DayCell;
  focus: HourCell | DayCell;
};

type ResizeSession = {
  kind: 'resize';
  taskId: string;
  startAt: string;
  dueAt: string;
  edge: 'start' | 'end';
  columnYmd: string;
  /** Quarter under the pointer when the edge was pressed. Null when that cell was covered. */
  origin: HourCell | null;
  focus: HourCell | null;
};

type CreateSession = {
  kind: 'create';
  anchor: HourCell | DayCell;
  focus: HourCell | DayCell;
};

type Session = MoveSession | ResizeSession | CreateSession;

export type ScheduleTimeEdit = ScheduleTimeChange & { taskId: string };

function editChange(session: MoveSession | ResizeSession, timeZone: string): ScheduleTimeChange | null {
  if (session.kind === 'resize') {
    if (session.focus === null) return null;
    if (
      session.origin !== null &&
      session.focus.hour === session.origin.hour &&
      session.focus.minute === session.origin.minute
    ) {
      return null;
    }
    return resizeTimedOccurrence({
      ymd: session.columnYmd,
      startAt: session.startAt,
      dueAt: session.dueAt,
      edge: session.edge,
      hour: session.focus.hour,
      minute: session.focus.minute,
      timeZone,
    });
  }
  if (session.isAllDay) {
    if (session.origin.kind !== 'day' || session.focus.kind !== 'day') return null;
    return shiftAllDayOccurrence({
      startYmd: session.spanStartYmd,
      endYmd: session.spanEndYmd,
      originYmd: session.origin.ymd,
      targetYmd: session.focus.ymd,
      timeZone,
    });
  }
  if (session.origin.kind === 'hour' && session.focus.kind === 'hour') {
    return shiftTimedOccurrence({
      startAt: session.startAt,
      dueAt: session.dueAt,
      origin: session.origin,
      target: session.focus,
    });
  }
  if (session.origin.kind === 'day' && session.focus.kind === 'day') {
    return shiftTimedByDays({
      startAt: session.startAt,
      dueAt: session.dueAt,
      originYmd: session.origin.ymd,
      targetYmd: session.focus.ymd,
    });
  }
  return null;
}

function highlightsOf(session: Session, timeZone: string): ScheduleCreateRange[] {
  if (session.kind === 'create') {
    const range = scheduleGestureRange(session.anchor, session.focus, timeZone);
    return range === null ? [] : [range];
  }
  const change = editChange(session, timeZone);
  return change === null ? [] : scheduleChangeHighlight(change, timeZone);
}

function withFocus(
  session: Session,
  point: HourCell | DayCell | null,
): Session {
  if (session.kind === 'create') {
    if (point === null || point.kind !== session.anchor.kind) return session;
    return { ...session, focus: point };
  }
  if (session.kind === 'move') {
    if (point === null || point.kind !== session.origin.kind) return session;
    return { ...session, focus: point };
  }
  if (point === null || point.kind !== 'hour') return session;
  return { ...session, focus: point };
}

/**
 * Press on an empty cell, drag across sibling cells, release to create.
 * Press on an occurrence and release on another cell to move it.
 * Press a block edge to change that end. A release on the same cell is a click.
 * Listeners sit on window so the release still counts after the pointer
 * leaves the cell that received the press. Layout size is never read.
 */
export function useScheduleGesture(
  timeZone: string,
  blocked: boolean,
  onCommit: (range: ScheduleCreateRange) => void,
  onEdit: (edit: ScheduleTimeEdit) => void,
): {
  highlights: ScheduleCreateRange[];
  consumeMoved: () => boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const sessionRef = useRef<Session | null>(null);
  const movedRef = useRef(false);
  const [highlights, setHighlights] = useState<ScheduleCreateRange[]>([]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    function focusFrom(event: { target: EventTarget | null; clientX?: number; clientY?: number }): void {
      const session = sessionRef.current;
      if (session === null) return;
      const next = withFocus(session, scheduleCellFromPointer(event));
      sessionRef.current = next;
      setHighlights(highlightsOf(next, timeZone));
    }
    function finish(commit: boolean, event: PointerEvent | null): void {
      const session = sessionRef.current;
      const current =
        commit && event !== null && session !== null
          ? withFocus(session, scheduleCellFromPointer(event))
          : session;
      sessionRef.current = null;
      if (commit && current !== null) {
        if (current.kind === 'create') {
          const range = scheduleGestureRange(current.anchor, current.focus, timeZone);
          if (range) onCommit(range);
        } else {
          const change = editChange(current, timeZone);
          if (change !== null) {
            movedRef.current = true;
            onEdit({ taskId: current.taskId, ...change });
          }
        }
      }
      setDragging(false);
      setHighlights([]);
    }
    function onMove(event: PointerEvent): void {
      focusFrom(event);
    }
    function onUp(event: PointerEvent): void {
      finish(true, event);
    }
    function onCancel(): void {
      finish(false, null);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') finish(false, null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [dragging, onCommit, onEdit, timeZone]);

  function consumeMoved(): boolean {
    const moved = movedRef.current;
    movedRef.current = false;
    return moved;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    movedRef.current = false;
    // Synthetic pointer events in tests omit `button`. A real primary press is 0.
    if (blocked || (event.button !== undefined && event.button !== 0)) return;
    const edit = readScheduleEdit(event.target);
    if (edit !== null) {
      const point = scheduleCellFromPointer(event);
      if (edit.edge !== null) {
        const hour = point?.kind === 'hour' ? point : null;
        const session: ResizeSession = {
          kind: 'resize',
          taskId: edit.taskId,
          startAt: edit.startAt,
          dueAt: edit.dueAt,
          edge: edit.edge,
          columnYmd: edit.columnYmd,
          origin: hour,
          focus: hour,
        };
        sessionRef.current = session;
        setHighlights(highlightsOf(session, timeZone));
        setDragging(true);
        return;
      }
      if (point === null) return;
      if (edit.isAllDay && point.kind !== 'day') return;
      const session: MoveSession = {
        kind: 'move',
        taskId: edit.taskId,
        startAt: edit.startAt,
        dueAt: edit.dueAt,
        isAllDay: edit.isAllDay,
        spanStartYmd: edit.spanStartYmd,
        spanEndYmd: edit.spanEndYmd,
        origin: point,
        focus: point,
      };
      sessionRef.current = session;
      setHighlights(highlightsOf(session, timeZone));
      setDragging(true);
      return;
    }
    if (schedulePointerOnItem(event.target)) return;
    const point = scheduleCellFromEventTarget(event.target);
    if (point === null) return;
    const session: CreateSession = { kind: 'create', anchor: point, focus: point };
    sessionRef.current = session;
    setHighlights(highlightsOf(session, timeZone));
    setDragging(true);
  }

  return { highlights, consumeMoved, onPointerDown };
}
