import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  foldAgendaDays,
  noteRepeatsTasks,
  planSignalCounts,
  type AgendaLine,
  type NowRecommendation,
  type Outcome,
  type TodayModuleId,
  type TodayNow,
  type TodayPlan,
  type TodayPlanMark,
} from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { copy } from '../../lib/copy';
import { formatDay, formatHm, localDateStamp } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { useOpenTask } from '../../components/TaskSheetHost';
import type { TodayBriefingModel } from './briefing';
import { groupTodayModuleRows } from './briefing-core';

/** The web sidebar is gone here, so short modules pair once the screen can hold two cards. */
const MODULE_PAIR_MIN_WIDTH = 360;

/** Collapse state of the briefing grid survives relaunches（与 web 的 vital.today.briefing-open 对齐）. */
const BRIEFING_OPEN_KEY = 'vital.today.briefing-open';

function readBriefingOpen(): Promise<boolean> {
  return SecureStore.getItemAsync(BRIEFING_OPEN_KEY)
    .then((raw) => raw === '1')
    .catch(() => false);
}

function writeBriefingOpen(open: boolean): void {
  void SecureStore.setItemAsync(BRIEFING_OPEN_KEY, open ? '1' : '0').catch(() => undefined);
}

/**
 * 今天简报：优先事项、天气穿衣、最近安排和最近节假日。日历日程已写成任务。
 * 「建议开始」仍在卡内；「换一个」本地轮转。
 */
export function NowCard({
  now,
  outcomes,
  timeZone,
  briefing,
}: {
  now: TodayNow;
  outcomes: Outcome[];
  timeZone: string;
  briefing: TodayBriefingModel;
}) {
  const t = useTheme();
  const openTask = useOpenTask();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(t), [t]);
  // 速览条：默认收起（设计稿 apps/web/design/today.html 画板 1/2），选择持久化。
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readBriefingOpen().then((open) => {
      if (!cancelled) setExpanded(open);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleExpanded(next: boolean): void {
    setExpanded(next);
    writeBriefingOpen(next);
  }

  const modules = briefing.modules.filter(
    (module) => module.id !== 'note' || !noteRepeatsTasks(module.text ?? '', briefing.lead.titles),
  );
  const moduleRows = groupTodayModuleRows(modules, width >= MODULE_PAIR_MIN_WIDTH ? 2 : 1);
  const [offset, setOffset] = useState(0);
  const recs = now.recommendations;
  // 双推荐并排：从 offset 起取连续两条（本地轮转，数据层不动）。
  const shown: NowRecommendation[] = [];
  for (let i = 0; i < Math.min(2, recs.length); i += 1) {
    const rec = recs[(offset + i) % recs.length];
    if (rec) shown.push(rec);
  }

  const [placeDraft, setPlaceDraft] = useState('');
  const [editingPlace, setEditingPlace] = useState(false);

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

  // 收起态：一行速览条（天气/节假日/优先计数/第一条推荐），任务列表不用滑远。
  if (!expanded) {
    const weather = briefing.weather;
    const tally = planSignalCounts(briefing.lead.counts);
    const first = recs[0] ?? null;
    return (
      <View testID="now-card" style={[styles.card, rnShadow(t)]}>
        <View style={styles.accent} />
        <View style={styles.body}>
          <View style={styles.glanceHead}>
            <Text style={styles.eyebrow}>{copy.today.glance.title}</Text>
            <Button variant="ghost" size="sm" onPress={() => toggleExpanded(true)}>
              {copy.today.glance.expand}
            </Button>
          </View>
          <View style={styles.glanceChips}>
            {weather.status === 'ready' ? (
              <Text style={styles.chip}>
                {weather.place} · {weather.condition} {weather.temperatureC}°C
              </Text>
            ) : null}
            <Text style={styles.chip}>
              {briefing.holidayName} · {briefing.holidayDate}
            </Text>
            {tally.map((part) => (
              <Text
                key={part.key}
                style={[styles.chip, { color: glanceTallyColor(part.key, t) }]}
              >
                {copy.today.briefing.planCount[part.key].replace('{n}', String(part.n))}
              </Text>
            ))}
            {first ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => openTask(first.taskId)}
                style={({ pressed }) => [pressed && styles.miniPressed]}
              >
                <Text style={styles.glanceRec} numberOfLines={1}>
                  ✦ {copy.today.glance.recommend.replace('{title}', first.title)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View testID="now-card" style={[styles.card, rnShadow(t)]}>
      <View style={styles.accent} />
      <View style={styles.body}>
        <View style={styles.glanceHead}>
          <Text style={styles.eyebrow}>{copy.today.now.title}</Text>
          <Button variant="ghost" size="sm" onPress={() => toggleExpanded(false)}>
            {copy.today.glance.collapse}
          </Button>
        </View>
        <View style={styles.modules}>
          {moduleRows.map((row) => {
            const key = row.map((module) => module.id).join('-');
            if (isAgendaRow(row)) {
              return (
                <View key={key} testID={`today-module-${row[0]?.id ?? 'agenda'}`} style={styles.module}>
                  <AgendaBlock briefing={briefing} styles={styles} />
                </View>
              );
            }
            return (
              <View key={key} style={styles.moduleRow}>
                {row.map((module) => (
                  <View key={module.id} testID={`today-module-${module.id}`} style={styles.module}>
                    <ModuleBlock
                      moduleId={module.id}
                      note={module.text}
                      briefing={briefing}
                      shown={shown}
                      recs={recs.length}
                      placeDraft={placeDraft}
                      editingPlace={editingPlace}
                      onEditPlace={() => setEditingPlace(true)}
                      onPlaceDraft={setPlaceDraft}
                      onSubmitPlace={() => {
                        briefing.submitPlace(placeDraft);
                        setEditingPlace(false);
                      }}
                      onSwap={() => setOffset((value) => value + 1)}
                      dueLabel={dueLabel}
                      estimateLabel={estimateLabel}
                      outcomeName={outcomeName}
                      onOpen={openTask}
                      styles={styles}
                    />
                  </View>
                ))}
              </View>
            );
          })}
        </View>
        <Text style={styles.meta}>{metaLine}</Text>
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
    glanceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    glanceChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: t.space[2],
      marginTop: t.space[2],
    },
    chip: {
      borderRadius: 999,
      backgroundColor: t.bgSurfaceMuted,
      paddingHorizontal: t.space[2],
      paddingVertical: 2,
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      color: t.textSecondary,
      overflow: 'hidden',
    },
    glanceRec: {
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      fontWeight: '500',
      color: t.accentPrimary,
    },
    modules: { gap: t.space[2], marginTop: t.space[2] },
    moduleRow: { flexDirection: 'row', gap: t.space[2] },
    module: {
      flex: 1,
      minWidth: 0,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borderSubtle,
      backgroundColor: t.bgCanvas,
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[3],
      gap: 4,
    },
    moduleEyebrow: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      color: t.textTertiary,
    },
    moduleHead: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    fact: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.fgPrimary,
    },
    factMuted: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textTertiary,
    },
    planRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    planMark: {
      width: 32,
      fontSize: 11,
      lineHeight: t.type.meta.lineHeight,
      fontWeight: '600',
    },
    planTitle: {
      flex: 1,
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.fgPrimary,
    },
    placeRow: { flexDirection: 'row', alignItems: 'center', gap: t.space[2], marginTop: t.space[1] },
    placeInput: {
      flex: 1,
      minWidth: 0,
      height: 36,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      backgroundColor: t.bgSurfaceMuted,
      color: t.fgPrimary,
      fontSize: t.type.meta.fontSize,
    },
    meta: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      color: t.textSecondary,
    },
    suggestTitle: { flex: 1, color: t.textTertiary },
    reco: { gap: t.space[2], marginTop: t.space[2] },
    mini: {
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

function isAgendaRow(row: readonly { id: string }[]): boolean {
  return row.length > 0 && row.every((module) => module.id === 'upcoming');
}

/** 速览条计数 chip 的着色：逾期/紧急红、高优橙，其余 muted。 */
function glanceTallyColor(key: TodayPlanMark, theme: Theme): string {
  if (key === 'overdue' || key === 'urgent') return theme.statusOverdue;
  if (key === 'high') return theme.statusDueSoon;
  return theme.textTertiary;
}

function monthDay(ymd: string): string {
  const [, month, day] = ymd.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function agendaLineLabel(line: AgendaLine): string {
  const count = line.count > 1 ? copy.today.briefing.agendaCount.replace('{n}', String(line.count)) : null;
  return [line.title, line.clock, count].filter((part): part is string => part !== null && part !== '').join(' · ');
}

function AgendaBlock({
  briefing,
  styles,
}: {
  briefing: TodayBriefingModel;
  styles: ReturnType<typeof createStyles>;
}) {
  const days = foldAgendaDays(briefing.upcoming);
  return (
    <View>
      <Text style={styles.moduleEyebrow}>{copy.today.briefing.module.upcoming}</Text>
      {days.length === 0 ? <Text style={styles.fact}>{copy.today.briefing.upcomingEmpty}</Text> : null}
      {days.map((day) => (
        <View key={day.ymd}>
          <Text style={styles.moduleEyebrow}>{monthDay(day.ymd)}</Text>
          {day.lines.map((line) => (
            <Text key={line.key} style={styles.fact}>
              {agendaLineLabel(line)}
            </Text>
          ))}
          {day.hidden > 0 ? (
            <Text style={styles.factMuted}>{copy.today.briefing.dayMore.replace('{n}', String(day.hidden))}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function markColor(mark: TodayPlanMark, theme: Theme): string {
  if (mark === 'overdue' || mark === 'urgent') return theme.statusOverdue;
  if (mark === 'high') return theme.statusDueSoon;
  return theme.statusDoing;
}

function LeadBrief({
  plan,
  styles,
}: {
  plan: TodayPlan;
  styles: ReturnType<typeof createStyles>;
}) {
  const theme = useTheme();
  const open =
    plan.counts.overdue + plan.counts.urgent + plan.counts.high + plan.counts.medium + plan.counts.plain;
  if (open === 0) {
    return (
      <View testID="today-lead">
        <Text style={styles.fact}>{copy.today.briefing.empty}</Text>
      </View>
    );
  }
  if (plan.items.length === 0) {
    return (
      <View testID="today-lead">
        <Text style={styles.fact}>{copy.today.briefing.planPlain.replace('{n}', String(plan.counts.plain))}</Text>
      </View>
    );
  }
  const tally =
    plan.items.length > 1 || plan.rest > 0
      ? planSignalCounts(plan.counts)
          .map((part) => copy.today.briefing.planCount[part.key].replace('{n}', String(part.n)))
          .join(' · ')
      : null;
  return (
    <View testID="today-lead">
      {tally ? <Text style={styles.factMuted}>{tally}</Text> : null}
      {plan.items.map((item) => (
        <View key={item.id} style={styles.planRow}>
          <Text style={[styles.planMark, { color: markColor(item.mark, theme) }]}>
            {copy.today.briefing.planMark[item.mark]}
          </Text>
          <Text style={styles.planTitle}>
            {item.title}
            {item.when ? ` · ${item.when}` : ''}
          </Text>
        </View>
      ))}
      {plan.rest > 0 ? (
        <Text style={styles.factMuted}>{copy.today.briefing.planRest.replace('{n}', String(plan.rest))}</Text>
      ) : null}
    </View>
  );
}

function moduleLabel(id: TodayModuleId): string {
  if (id === 'focus') return copy.today.now.suggestTitle;
  return copy.today.briefing.module[id];
}

function ModuleBlock({
  moduleId,
  note,
  briefing,
  shown,
  recs,
  placeDraft,
  editingPlace,
  onEditPlace,
  onPlaceDraft,
  onSubmitPlace,
  onSwap,
  dueLabel,
  estimateLabel,
  outcomeName,
  onOpen,
  styles,
}: {
  moduleId: TodayModuleId;
  note?: string;
  briefing: TodayBriefingModel;
  shown: NowRecommendation[];
  recs: number;
  placeDraft: string;
  editingPlace: boolean;
  onEditPlace: () => void;
  onPlaceDraft: (value: string) => void;
  onSubmitPlace: () => void;
  onSwap: () => void;
  dueLabel: (item: NowRecommendation) => { text: string; color: string } | null;
  estimateLabel: (item: NowRecommendation) => string;
  outcomeName: (id: string | null) => string | null;
  onOpen: (taskId: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const weather = briefing.weather;
  const showPlaceForm = weather.status !== 'ready' || editingPlace;
  return (
    <View>
      <View style={styles.moduleHead}>
        <Text style={[styles.moduleEyebrow, styles.suggestTitle]}>{moduleLabel(moduleId)}</Text>
        {moduleId === 'focus' ? (
          <Button variant="ghost" size="sm" disabled={recs < 2} onPress={onSwap}>
            {copy.today.now.swap}
          </Button>
        ) : null}
      </View>
      {moduleId === 'note' ? <Text style={styles.fact}>{note}</Text> : null}
      {moduleId === 'lead' ? <LeadBrief plan={briefing.lead} styles={styles} /> : null}
      {moduleId === 'weather' ? (
        <View>
          {weather.status === 'loading' ? (
            <Text style={styles.fact}>{copy.today.briefing.weatherLoading}</Text>
          ) : null}
          {weather.status === 'unavailable' ? (
            <Text style={styles.fact}>{copy.today.briefing.weatherUnavailable}</Text>
          ) : null}
          {weather.status === 'ready' ? (
            <Text style={styles.fact}>
              {weather.place} · {weather.condition} {weather.temperatureC}°C
            </Text>
          ) : null}
          {weather.status === 'ready' ? <Text style={styles.fact}>{weather.clothing}</Text> : null}
          {weather.status === 'ready' && !showPlaceForm ? (
            <Button size="sm" variant="ghost" onPress={onEditPlace}>
              {copy.today.briefing.setPlace}
            </Button>
          ) : null}
          {showPlaceForm ? (
            <View style={styles.placeRow}>
              <TextInput
                value={placeDraft}
                onChangeText={onPlaceDraft}
                placeholder={copy.today.briefing.placePlaceholder}
                style={styles.placeInput}
                accessibilityLabel={copy.today.briefing.setPlace}
                onSubmitEditing={onSubmitPlace}
              />
              <Button size="sm" variant="ghost" disabled={briefing.placeBusy} onPress={onSubmitPlace}>
                {copy.today.briefing.setPlace}
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}
      {moduleId === 'holiday' ? (
        <Text style={styles.fact}>
          {briefing.holidayName} · {briefing.holidayDate}
        </Text>
      ) : null}
      {moduleId === 'focus' && shown.length > 0 ? (
        <View style={styles.reco}>
          {shown.map((rec) => {
            const due = dueLabel(rec);
            const thread = outcomeName(rec.outcomeId);
            return (
              <Pressable
                key={rec.taskId}
                accessibilityRole="button"
                onPress={() => onOpen(rec.taskId)}
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
  );
}
