import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReportHeatCell } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../../theme/use-theme';
import { withAlpha } from '../../ui/color';
import { heatAlphaHex, mondayFirstCol, todayYmd } from './period-label';

/**
 * 月历式热力：day 粒度按周一起始 7 列网格（含前导空格）；
 * month/year 粒度保持简单格子流。绝对刻度 alpha 见 heatAlphaHex。
 */
export function HeatmapCalendar({
  cells,
  grain,
  selectedDate,
  onPick,
}: {
  cells: ReportHeatCell[];
  grain: 'day' | 'month' | 'year';
  selectedDate?: string;
  onPick: (date: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const today = todayYmd();
  const leading = grain === 'day' && cells.length > 0 ? mondayFirstCol(cells[0]?.date ?? '') : 0;

  return (
    <View style={styles.grid}>
      {Array.from({ length: leading }, (_, i) => (
        <View key={`blank-${String(i)}`} style={styles.cell} />
      ))}
      {cells.map((cell) => {
        const lit = cell.completed > 0;
        const selected = cell.date === selectedDate;
        const isToday = cell.date === today;
        return (
          <View key={cell.date} style={styles.cell}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={cell.date}
              onPress={() => onPick(cell.date)}
              style={({ pressed }) => [
                styles.day,
                lit &&
                  !selected && {
                    backgroundColor: withAlpha(t.accentPrimary, heatAlphaHex(cell.completed)),
                  },
                selected && { backgroundColor: t.accentPrimary },
                isToday && !selected && styles.today,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.num, selected && styles.numSelected]}>
                {grain === 'year'
                  ? cell.date.slice(0, 4)
                  : grain === 'month'
                    ? `${Number(cell.date.slice(5, 7))}月`
                    : String(Number(cell.date.slice(8)))}
              </Text>
              <View
                style={[
                  styles.dot,
                  cell.wrote && { backgroundColor: selected ? t.fgOnAccent : t.accentPrimary },
                ]}
              />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: '14.2857%', alignItems: 'center', paddingVertical: 2 },
    day: {
      width: 40,
      height: 44,
      borderRadius: t.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    today: { borderWidth: 2, borderColor: t.accentPrimary },
    pressed: { opacity: 0.7 },
    num: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.fgPrimary,
      fontVariant: ['tabular-nums'],
    },
    numSelected: { color: t.fgOnAccent, fontWeight: '600' },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  });
