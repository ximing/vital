import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { NowRecommendation, Outcome, TodayModuleId, TodayNow } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { copy } from '../../lib/copy';
import { formatDay, formatHm, localDateStamp } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { useOpenTask } from '../../components/TaskSheetHost';
import type { TodayBriefingModel } from './briefing';
import { groupTodayModuleRows } from './briefing-core';
import { openPhoneCalendarAccess } from './phone-calendar';

/** The web sidebar is gone here, so short modules pair once the screen can hold two cards. */
const MODULE_PAIR_MIN_WIDTH = 360;

/**
 * 今天简报：当天要做什么、天气穿衣、本地日历日程、最近安排和最近节假日。
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
  const moduleRows = groupTodayModuleRows(briefing.modules, width >= MODULE_PAIR_MIN_WIDTH ? 2 : 1);
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

  return (
    <View testID="now-card" style={[styles.card, rnShadow(t)]}>
      <View style={styles.accent} />
      <View style={styles.body}>
        <Text style={styles.eyebrow}>{copy.today.now.title}</Text>
        <View style={styles.modules}>
          {moduleRows.map((row) => (
            <View key={row.map((module) => module.id).join('-')} style={styles.moduleRow}>
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
          ))}
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
    moduleLead: {
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    moduleHead: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    fact: {
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

function MeetingsBlock({
  meetings,
  styles,
}: {
  meetings: TodayBriefingModel['meetings'];
  styles: ReturnType<typeof createStyles>;
}) {
  if (meetings.status === 'loading' || meetings.status === 'skipped') {
    return <Text style={styles.fact}>{copy.today.briefing.meetingsLoading}</Text>;
  }
  if (meetings.status === 'denied') {
    return (
      <View>
        <Text style={styles.fact}>{copy.today.briefing.meetingsDenied}</Text>
        <Text style={styles.meta}>{copy.today.briefing.meetingsDeniedHint}</Text>
        <Button size="sm" variant="ghost" onPress={() => void openPhoneCalendarAccess()}>
          {copy.today.briefing.meetingsOpenSettings}
        </Button>
      </View>
    );
  }
  if (meetings.status === 'failed') {
    return <Text style={styles.fact}>{copy.today.briefing.meetingsFailed}</Text>;
  }
  if (meetings.events.length === 0) {
    return <Text style={styles.fact}>{copy.today.briefing.meetingsEmpty}</Text>;
  }
  return (
    <View>
      {meetings.events.map((event, index) => (
        <Text key={`${event.start}-${event.title}-${index}`} style={styles.fact}>
          {event.title} · {event.allDay ? copy.today.briefing.allDay : event.start}
        </Text>
      ))}
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
      {moduleId === 'lead' ? <Text style={styles.moduleLead}>{briefing.lead}</Text> : null}
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
      {moduleId === 'meetings' ? <MeetingsBlock meetings={briefing.meetings} styles={styles} /> : null}
      {moduleId === 'upcoming' ? (
        <View>
          {briefing.upcoming.length === 0 ? (
            <Text style={styles.fact}>{copy.today.briefing.upcomingEmpty}</Text>
          ) : (
            briefing.upcoming.map((item) => (
              <Text key={item.id} style={styles.fact}>
                {item.title} · {item.when}
              </Text>
            ))
          )}
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
