import { useMemo, useRef, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../../theme/use-theme';
import { DragSurface } from './drag';
import {
  resizeTimedDraft,
  resizeTimedOccurrence,
  scheduleChangeHighlight,
  shiftChipByDay,
  shiftTimedDraft,
  shiftTimedOccurrence,
  timedDraftMinutes,
  type HourCell,
  type ScheduleCreateRange,
  type TimedCreateRange,
} from './gesture';
import { GRID_HEIGHT, QUARTER_H } from './grid';
import type { ScheduleChip, WeekBlock } from './place';
import type { ScheduleTimeEdit } from './schedule.service';

export type ScheduleActions = {
  timeZone: string;
  onEdit: (edit: ScheduleTimeEdit) => void;
  onOpen: (taskId: string) => void;
  onDraft: (range: ScheduleCreateRange) => void;
  setLive: (ranges: ScheduleCreateRange[] | null) => void;
  cellAt: (x: number, y: number) => HourCell | null;
  dayAt: (x: number, y: number) => string | null;
};

export function quarterMinute(timeLabel: string | null): number {
  if (timeLabel === null || timeLabel.length < 5) return 0;
  const minute = Number(timeLabel.slice(3, 5));
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return 0;
  return Math.floor(minute / 15) * 15;
}

function blockFrame(startMinute: number, endMinute: number): { top: number; height: number } {
  const top = (startMinute / 1440) * GRID_HEIGHT;
  const height = Math.max(((endMinute - startMinute) / 1440) * GRID_HEIGHT, QUARTER_H);
  return { top, height };
}

export function PointChip({
  chip,
  api,
}: {
  chip: ScheduleChip;
  api: RefObject<ScheduleActions>;
}) {
  const styles = useItemStyles();
  const origin = useRef<HourCell | null>(null);
  const movable = chip.locked !== true && chip.startAt !== undefined && chip.dueAt !== undefined;
  if (!movable || chip.startAt === undefined || chip.dueAt === undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={chip.title}
        onPress={() => api.current.onOpen(chip.taskId)}
        style={styles.chip}
        testID={`schedule-chip-${chip.taskId}`}
      >
        <Text numberOfLines={1} style={styles.chipText}>
          {chip.timeLabel ? `${chip.timeLabel} ` : ''}
          {chip.title}
        </Text>
      </Pressable>
    );
  }
  const startAt = chip.startAt;
  const dueAt = chip.dueAt;
  return (
    <DragSurface
      onGrant={(x, y) => {
        origin.current = api.current.cellAt(x, y);
      }}
      onMove={(x, y) => {
        const from = origin.current;
        const target = api.current.cellAt(x, y);
        if (from === null || target === null) return;
        const change = shiftTimedOccurrence({ startAt, dueAt, origin: from, target });
        api.current.setLive(change === null ? [] : scheduleChangeHighlight(change, api.current.timeZone));
      }}
      onEnd={(x, y, moved) => {
        api.current.setLive(null);
        const from = origin.current;
        const target = api.current.cellAt(x, y);
        if (!moved || from === null || target === null) {
          if (!moved) api.current.onOpen(chip.taskId);
          return;
        }
        const change = shiftTimedOccurrence({ startAt, dueAt, origin: from, target });
        if (change === null) api.current.onOpen(chip.taskId);
        else api.current.onEdit({ taskId: chip.taskId, ...change });
      }}
      style={styles.chip}
      testID={`schedule-chip-${chip.taskId}`}
    >
      <Text numberOfLines={1} style={styles.chipText}>
        {chip.timeLabel ? `${chip.timeLabel} ` : ''}
        {chip.title}
      </Text>
    </DragSurface>
  );
}

export function DayChip({
  chip,
  columnYmd,
  api,
}: {
  chip: ScheduleChip;
  columnYmd: string;
  api: RefObject<ScheduleActions>;
}) {
  const styles = useItemStyles();
  const label = chip.timeLabel ? `${chip.timeLabel} ${chip.title}` : chip.title;
  if (chip.locked === true || chip.startAt === undefined || chip.dueAt === undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => api.current.onOpen(chip.taskId)}
        style={styles.chip}
        testID={`schedule-chip-${chip.taskId}-${columnYmd}`}
      >
        <Text numberOfLines={1} style={styles.chipText}>
          {label}
        </Text>
      </Pressable>
    );
  }
  const startAt = chip.startAt;
  const dueAt = chip.dueAt;
  const isAllDay = chip.isAllDay === true;
  const spanStartYmd = chip.spanStartYmd ?? columnYmd;
  const spanEndYmd = chip.spanEndYmd ?? columnYmd;
  return (
    <DragSurface
      onGrant={() => undefined}
      onMove={(x, y) => {
        const target = api.current.dayAt(x, y);
        if (target === null) return;
        const change = shiftChipByDay({
          startAt,
          dueAt,
          isAllDay,
          spanStartYmd,
          spanEndYmd,
          originYmd: columnYmd,
          targetYmd: target,
          timeZone: api.current.timeZone,
        });
        api.current.setLive(change === null ? [] : scheduleChangeHighlight(change, api.current.timeZone));
      }}
      onEnd={(x, y, moved) => {
        api.current.setLive(null);
        if (!moved) {
          api.current.onOpen(chip.taskId);
          return;
        }
        const target = api.current.dayAt(x, y);
        if (target === null) return;
        const change = shiftChipByDay({
          startAt,
          dueAt,
          isAllDay,
          spanStartYmd,
          spanEndYmd,
          originYmd: columnYmd,
          targetYmd: target,
          timeZone: api.current.timeZone,
        });
        if (change !== null) api.current.onEdit({ taskId: chip.taskId, ...change });
      }}
      style={styles.chip}
      testID={`schedule-chip-${chip.taskId}-${columnYmd}`}
    >
      <Text numberOfLines={1} style={styles.chipText}>
        {label}
      </Text>
    </DragSurface>
  );
}

export function TimedBlock({
  block,
  columnYmd,
  laneStyle,
  api,
}: {
  block: WeekBlock;
  columnYmd: string;
  laneStyle: { left: number; width: number };
  api: RefObject<ScheduleActions>;
}) {
  const styles = useItemStyles();
  const origin = useRef<HourCell | null>(null);
  const frame = blockFrame(block.startMinute, block.endMinute);
  const box = [styles.block, { top: frame.top, height: frame.height, left: laneStyle.left, width: laneStyle.width }];
  if (block.locked) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${block.timeLabel} ${block.title}`}
        onPress={() => api.current.onOpen(block.taskId)}
        style={box}
        testID={`schedule-block-${block.taskId}-${columnYmd}`}
      >
        <Text numberOfLines={2} style={styles.blockTitle}>
          {block.title}
        </Text>
      </Pressable>
    );
  }
  return (
    <View pointerEvents="box-none" style={box} testID={`schedule-block-${block.taskId}-${columnYmd}`}>
      <DragSurface
        style={styles.blockBody}
        onGrant={(x, y) => {
          origin.current = api.current.cellAt(x, y);
        }}
        onMove={(x, y) => {
          const from = origin.current;
          const target = api.current.cellAt(x, y);
          if (from === null || target === null) return;
          const change = shiftTimedOccurrence({
            startAt: block.startAt,
            dueAt: block.dueAt,
            origin: from,
            target,
          });
          api.current.setLive(change === null ? [] : scheduleChangeHighlight(change, api.current.timeZone));
        }}
        onEnd={(x, y, moved) => {
          api.current.setLive(null);
          const from = origin.current;
          const target = api.current.cellAt(x, y);
          if (!moved || from === null || target === null) {
            if (!moved) api.current.onOpen(block.taskId);
            return;
          }
          const change = shiftTimedOccurrence({
            startAt: block.startAt,
            dueAt: block.dueAt,
            origin: from,
            target,
          });
          if (change === null) api.current.onOpen(block.taskId);
          else api.current.onEdit({ taskId: block.taskId, ...change });
        }}
      >
        <Text numberOfLines={frame.height >= 48 ? 1 : 2} style={styles.blockTitle}>
          {block.title}
        </Text>
        {frame.height >= 48 ? (
          <Text numberOfLines={1} style={styles.blockTime}>
            {block.timeLabel}
          </Text>
        ) : null}
      </DragSurface>
      {block.resizeStart ? (
        <EdgeHandle
          edge="start"
          columnYmd={columnYmd}
          block={block}
          api={api}
          style={styles.handleTop}
        />
      ) : null}
      {block.resizeEnd ? (
        <EdgeHandle
          edge="end"
          columnYmd={columnYmd}
          block={block}
          api={api}
          style={styles.handleBottom}
        />
      ) : null}
    </View>
  );
}

function EdgeHandle({
  edge,
  columnYmd,
  block,
  api,
  style,
}: {
  edge: 'start' | 'end';
  columnYmd: string;
  block: WeekBlock;
  api: RefObject<ScheduleActions>;
  style: object;
}) {
  const origin = useRef<HourCell | null>(null);
  return (
    <DragSurface
      style={style}
      testID={`schedule-resize-${edge}-${block.taskId}-${columnYmd}`}
      onGrant={(x, y) => {
        origin.current = api.current.cellAt(x, y);
      }}
      onMove={(x, y) => {
        const cell = api.current.cellAt(x, y);
        if (cell === null) return;
        const from = origin.current;
        if (from !== null && from.hour === cell.hour && from.minute === cell.minute) {
          api.current.setLive([]);
          return;
        }
        const change = resizeTimedOccurrence({
          ymd: columnYmd,
          startAt: block.startAt,
          dueAt: block.dueAt,
          edge,
          hour: cell.hour,
          minute: cell.minute,
          timeZone: api.current.timeZone,
        });
        api.current.setLive(change === null ? [] : scheduleChangeHighlight(change, api.current.timeZone));
      }}
      onEnd={(x, y, moved) => {
        api.current.setLive(null);
        if (!moved) return;
        const cell = api.current.cellAt(x, y);
        const from = origin.current;
        if (cell === null || (from !== null && from.hour === cell.hour && from.minute === cell.minute)) return;
        const change = resizeTimedOccurrence({
          ymd: columnYmd,
          startAt: block.startAt,
          dueAt: block.dueAt,
          edge,
          hour: cell.hour,
          minute: cell.minute,
          timeZone: api.current.timeZone,
        });
        if (change !== null) api.current.onEdit({ taskId: block.taskId, ...change });
      }}
    />
  );
}

export function TimedDraftBlock({
  draft,
  api,
}: {
  draft: TimedCreateRange;
  api: RefObject<ScheduleActions>;
}) {
  const styles = useItemStyles();
  const origin = useRef<HourCell | null>(null);
  const base = useRef(draft);
  const minutes = timedDraftMinutes(draft);
  const frame = blockFrame(minutes.start, minutes.end);
  return (
    <View
      pointerEvents="box-none"
      style={[styles.block, styles.draft, { top: frame.top, height: frame.height, left: 2, right: 2 }]}
    >
      <DragSurface
        style={styles.blockBody}
        onGrant={(x, y) => {
          base.current = draft;
          origin.current = api.current.cellAt(x, y);
        }}
        onMove={(x, y) => {
          const from = origin.current;
          const target = api.current.cellAt(x, y);
          if (from === null || target === null) return;
          const next = shiftTimedDraft(base.current, from, target, api.current.timeZone);
          if (next !== null) api.current.onDraft(next);
        }}
        onEnd={(x, y, moved) => {
          if (!moved) return;
          const from = origin.current;
          const target = api.current.cellAt(x, y);
          if (from === null || target === null) return;
          const next = shiftTimedDraft(base.current, from, target, api.current.timeZone);
          if (next !== null) api.current.onDraft(next);
        }}
      >
        <Text numberOfLines={1} style={styles.blockTime}>
          {draft.startHour.toString().padStart(2, '0')}:{draft.startMinute.toString().padStart(2, '0')}
        </Text>
      </DragSurface>
      <DraftEdge edge="start" draft={draft} api={api} style={styles.handleTop} />
      <DraftEdge edge="end" draft={draft} api={api} style={styles.handleBottom} />
    </View>
  );
}

function DraftEdge({
  edge,
  draft,
  api,
  style,
}: {
  edge: 'start' | 'end';
  draft: TimedCreateRange;
  api: RefObject<ScheduleActions>;
  style: object;
}) {
  return (
    <DragSurface
      style={style}
      onGrant={() => undefined}
      onMove={(x, y) => {
        const cell = api.current.cellAt(x, y);
        if (cell === null) return;
        const next = resizeTimedDraft(draft, edge, cell.hour, cell.minute, api.current.timeZone);
        if (next !== null) api.current.onDraft(next);
      }}
      onEnd={(x, y, moved) => {
        if (!moved) return;
        const cell = api.current.cellAt(x, y);
        if (cell === null) return;
        const next = resizeTimedDraft(draft, edge, cell.hour, cell.minute, api.current.timeZone);
        if (next !== null) api.current.onDraft(next);
      }}
    />
  );
}

function useItemStyles() {
  const t = useTheme();
  return useMemo(() => createStyles(t), [t]);
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    chip: {
      marginTop: 1,
      borderLeftWidth: 2,
      borderLeftColor: t.accentPrimary,
      backgroundColor: t.bgAccentSubtle,
      borderRadius: t.radius.sm,
      paddingHorizontal: t.space[1],
      minHeight: 18,
      justifyContent: 'center',
    },
    chipText: { fontSize: 11, lineHeight: 14, color: t.fgPrimary },
    block: {
      position: 'absolute',
      borderLeftWidth: 2,
      borderLeftColor: t.accentPrimary,
      backgroundColor: t.bgAccentSubtle,
      borderRadius: t.radius.sm,
      overflow: 'hidden',
    },
    draft: { borderStyle: 'solid' },
    blockBody: { flex: 1, paddingHorizontal: t.space[1], paddingTop: 8 },
    blockTitle: { fontSize: 11, lineHeight: 14, color: t.fgPrimary, fontWeight: '600' },
    blockTime: { fontSize: 10, lineHeight: 13, color: t.fgMuted, fontVariant: ['tabular-nums'] },
    handleTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 10 },
    handleBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 10 },
  });
}
