import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NowRecommendation, Outcome, TodayNow } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { copy } from '../../lib/copy';
import { formatDay, formatHm, localDateStamp } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { useOpenTask } from '../../components/TaskSheetHost';

/**
 * spec §f.3 NowCard：白卡 + 左 4px accent 竖条；「当下」eyebrow accent；时间 34/40 tabular-nums；
 * 副行 13 secondary；「建议开始」eyebrow + 右侧 ghost sm「换一个」；双推荐并排 mini 卡
 * （bgSurfaceMuted 底 radius 10 padding 12，标题 14/20 600 两行 + meta 12：估时 · 日期语义色）。
 * 点击 mini 卡打开全局任务浮层；「换一个」本地轮转（offset 步进，两条窗口滑动）。
 */
export function NowCard({
  now,
  outcomes,
  timeZone,
}: {
  now: TodayNow;
  outcomes: Outcome[];
  timeZone: string;
}) {
  const t = useTheme();
  const openTask = useOpenTask();
  const styles = useMemo(() => createStyles(t), [t]);
  const [offset, setOffset] = useState(0);
  const recs = now.recommendations;
  // 双推荐并排：从 offset 起取连续两条（本地轮转，数据层不动）。
  const shown: NowRecommendation[] = [];
  for (let i = 0; i < Math.min(2, recs.length); i += 1) {
    const rec = recs[(offset + i) % recs.length];
    if (rec) shown.push(rec);
  }

  const timeLabel = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date());

  function outcomeName(id: string | null): string | null {
    if (id === null) return null;
    return outcomes.find((outcome) => outcome.id === id)?.name ?? null;
  }

  function dueLabel(item: NowRecommendation): { text: string; color: string } | null {
    if (item.dueAt === null) return null;
    const dueYmd = localDateStamp(timeZone, new Date(item.dueAt));
    const todayYmd = localDateStamp(timeZone);
    if (dueYmd === todayYmd) {
      const hm = formatHm(item.dueAt, timeZone);
      return {
        text: hm === '00:00' ? copy.lists.today : `${copy.lists.today} ${hm}`,
        color: t.statusDoing,
      };
    }
    if (dueYmd < todayYmd) {
      return { text: formatDay(item.dueAt, timeZone), color: t.statusOverdue };
    }
    return { text: formatDay(item.dueAt, timeZone), color: t.textTertiary };
  }

  function estimateLabel(item: NowRecommendation): string {
    return item.estimateMinutes === null
      ? copy.today.now.noEstimate
      : copy.today.now.estimate.replace('{m}', String(item.estimateMinutes));
  }

  const metaLine = now.quiet
    ? copy.today.now.quietLabel
    : [copy.today.now.next.replace('{m}', String(now.continuousMinutes)), now.reason]
        .filter((part) => part.trim() !== '')
        .join(' · ');

  return (
    <View testID="now-card" style={[styles.card, rnShadow(t)]}>
      <View style={styles.accent} />
      <View style={styles.body}>
        <Text style={styles.eyebrow}>{copy.today.now.title}</Text>
        <Text style={styles.time}>{timeLabel}</Text>
        <Text style={styles.meta}>{metaLine}</Text>

        <View style={styles.suggestHead}>
          <Text style={[styles.eyebrow, styles.suggestTitle]}>{copy.today.now.suggestTitle}</Text>
          <Button
            variant="ghost"
            size="sm"
            disabled={recs.length < 2}
            onPress={() => setOffset((value) => value + 1)}
          >
            {copy.today.now.swap}
          </Button>
        </View>

        {shown.length > 0 ? (
          <View style={styles.reco}>
            {shown.map((rec) => {
              const due = dueLabel(rec);
              const thread = outcomeName(rec.outcomeId);
              return (
                <Pressable
                  key={rec.taskId}
                  accessibilityRole="button"
                  onPress={() => openTask(rec.taskId)}
                  style={({ pressed }) => [styles.mini, pressed && styles.miniPressed]}
                >
                  <Text style={styles.miniTitle} numberOfLines={2}>
                    {rec.title}
                  </Text>
                  <Text style={styles.miniMeta} numberOfLines={1}>
                    {thread ? <Text style={styles.miniMetaPart}>{thread} · </Text> : null}
                    <Text style={styles.miniMetaPart}>{estimateLabel(rec)}</Text>
                    {due ? <Text style={{ color: due.color }}> · {due.text}</Text> : null}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      marginTop: t.space[2],
      marginHorizontal: t.space[4],
      flexDirection: 'row',
      overflow: 'hidden',
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
    },
    accent: { width: 4, backgroundColor: t.accentPrimary },
    body: {
      flex: 1,
      minWidth: 0,
      paddingLeft: t.space[5],
      paddingRight: t.space[4],
      paddingVertical: t.space[4],
      gap: t.space[1],
    },
    eyebrow: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      letterSpacing: 1,
      color: t.accentPrimary,
    },
    time: {
      fontSize: 34,
      lineHeight: 40,
      fontWeight: '700',
      color: t.fgPrimary,
      fontVariant: ['tabular-nums'],
    },
    meta: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textSecondary,
    },
    suggestHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      marginTop: t.space[3],
      marginBottom: t.space[2],
    },
    suggestTitle: { flex: 1, color: t.textTertiary },
    reco: { flexDirection: 'row', gap: 10 },
    mini: {
      flex: 1,
      minWidth: 0,
      borderRadius: 10,
      backgroundColor: t.bgSurfaceMuted,
      padding: t.space[3],
    },
    miniPressed: { opacity: 0.7 },
    miniTitle: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    miniMeta: {
      marginTop: 6,
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textTertiary,
    },
    miniMetaPart: { fontVariant: ['tabular-nums'] },
  });
