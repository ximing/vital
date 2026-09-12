import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Outcome, OutcomeSignal } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { PickerSheet } from '../../components/PickerSheet';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { withAlpha } from '../../ui/color';
import { cardDisplay } from './model';

function signalColors(signal: OutcomeSignal, t: Theme): { fg: string; bg: string } {
  // spec §f.7 signal chip 语义色：up 绿 / flat 灰 / alert 琥珀。
  if (signal === 'up') return { fg: t.statusDone, bg: withAlpha(t.statusDone, '1F') };
  if (signal === 'alert') return { fg: t.statusDueSoon, bg: withAlpha(t.statusDueSoon, '1F') };
  return { fg: t.textSecondary, bg: t.bgSurfaceMuted };
}

export function OutcomeCard({
  outcome,
  now,
  onClose,
  onReopen,
  onUndo,
  onRetry,
}: {
  outcome: Outcome;
  now: Date;
  onClose: () => void;
  onReopen: () => void;
  onUndo: () => void;
  onRetry: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [menu, setMenu] = useState(false);
  const view = cardDisplay(outcome, now);
  const signal = view.signal ? signalColors(view.signal, t) : null;

  const options = [
    outcome.status === 'open'
      ? { key: 'close', label: copy.today.closeThread, run: onClose }
      : { key: 'reopen', label: copy.today.reopenThread, run: onReopen },
    ...(view.undoable ? [{ key: 'undo', label: copy.today.undo, run: onUndo }] : []),
    { key: 'refresh', label: copy.today.refreshOutcome, run: onRetry },
  ];

  return (
    <>
      <Pressable
        testID="outcome-card"
        accessibilityRole="button"
        onPress={() => setMenu(true)}
        style={({ pressed }) => [styles.card, rnShadow(t), pressed && styles.pressed]}
      >
        <View style={styles.head}>
          <Text style={styles.name} numberOfLines={1}>
            {outcome.name}
          </Text>
          {view.signal && signal ? (
            <View style={[styles.badge, { backgroundColor: signal.bg }]}>
              <Text style={[styles.badgeText, { color: signal.fg }]}>
                {copy.today.signal[view.signal]}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.headline}>
          {view.pending ? (
            <>
              <View style={styles.skel} />
              <View style={[styles.skel, styles.skelShort]} />
            </>
          ) : view.headline ? (
            <Text style={styles.headlineText} numberOfLines={2}>
              {view.headline}
            </Text>
          ) : null}
        </View>

        {view.nextStep ? (
          <View style={styles.next}>
            <Text style={styles.nextLabel}>{copy.today.nextStep}</Text>
            <Text style={styles.nextText} numberOfLines={1}>
              {view.nextStep}
            </Text>
          </View>
        ) : (
          <View style={styles.nextSpacer} />
        )}

        <View style={styles.foot}>
          <Text style={styles.stat}>
            {copy.today.openTasks.replace('{n}', String(outcome.openTaskCount))}
          </Text>
          {outcome.materialCount > 0 ? (
            <Text style={styles.stat}>
              {copy.today.materials.replace('{n}', String(outcome.materialCount))}
            </Text>
          ) : null}
          {view.failed ? (
            <Pressable
              accessibilityRole="button"
              onPress={(event) => {
                event.stopPropagation();
                onRetry();
              }}
              style={styles.retry}
            >
              <Text style={styles.retryText}>{copy.today.retry}</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
      <PickerSheet visible={menu} title={outcome.name} onClose={() => setMenu(false)}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            onPress={() => {
              setMenu(false);
              option.run();
            }}
            style={styles.option}
          >
            <Text style={styles.optionLabel}>{option.label}</Text>
          </Pressable>
        ))}
      </PickerSheet>
    </>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    // spec §1.2 内容卡：bgElevated + radius.lg + rnShadow，无描边。
    card: {
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      overflow: 'hidden',
      padding: t.space[4],
      gap: t.space[2],
      minHeight: 150,
    },
    pressed: { opacity: 0.7 },
    head: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    name: {
      flex: 1,
      minWidth: 0,
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    badge: {
      height: t.space[6],
      borderRadius: t.radius.pill,
      paddingHorizontal: 10,
      justifyContent: 'center',
    },
    badgeText: { fontSize: t.type.caption.fontSize, fontWeight: '500' },
    headline: { minHeight: 20, gap: 6 },
    headlineText: { fontSize: t.type.meta.fontSize, lineHeight: 20, color: t.fgMuted },
    skel: {
      height: 13,
      width: '92%',
      borderRadius: 2,
      backgroundColor: t.bgSurfaceMuted,
    },
    skelShort: { width: '64%' },
    next: { marginTop: 'auto', paddingTop: t.space[3], gap: 2 },
    nextSpacer: { marginTop: 'auto' },
    nextLabel: {
      fontSize: 11,
      letterSpacing: 0.8,
      color: t.textTertiary,
    },
    nextText: {
      fontSize: t.type.body.fontSize,
      fontWeight: '500',
      color: t.fgPrimary,
    },
    foot: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: t.space[2],
      marginTop: t.space[2],
      paddingTop: t.space[3],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borderSubtle,
    },
    stat: { fontSize: 11, color: t.textTertiary, fontVariant: ['tabular-nums'] },
    retry: { marginLeft: 'auto' },
    retryText: { fontSize: 11, fontWeight: '600', color: t.statusDueSoon },
    option: {
      minHeight: t.hit,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      justifyContent: 'center',
    },
    optionLabel: { fontSize: t.type.body.fontSize, color: t.fgPrimary },
  });
