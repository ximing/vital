import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { EnergyLog } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { formatHm, localDateStamp } from '../../lib/format';
import { useTheme } from '../../theme/use-theme';

const LEVELS = [1, 2, 3, 4, 5] as const;

function labelOf(log: EnergyLog): string {
  const mood = log.mood ? ` · ${log.mood}` : '';
  const note = log.note ? ` · ${log.note}` : '';
  return `${copy.today.energyLevel.replace('{n}', String(log.energy))}${mood}${note}`;
}

export function EnergyLogPad({
  timeZone,
  readOnly = false,
}: {
  timeZone: string;
  readOnly?: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const zone = timeZone;
  const [items, setItems] = useState<EnergyLog[]>([]);
  const [mood, setMood] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const date = localDateStamp(zone);
      const page = await client.listEnergyLogs({ date });
      setItems(page.items);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, [zone]);
  useFocusReload(reload);

  async function save(energy: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.createEnergyLog({
        energy,
        mood,
        note: note.trim() === '' ? null : note.trim(),
      });
      setMood(null);
      setNote('');
      await reload();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  const ordered = [...items].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const latest = ordered[ordered.length - 1];
  const earlier = ordered.slice(0, -1);
  const latestQuiet = latest
    ? [formatHm(latest.loggedAt, zone), latest.mood, latest.note].filter((part) => part !== null && part !== '').join(' · ')
    : '';

  if (readOnly) {
    return (
      <View style={styles.wrap} accessibilityLabel={copy.days.energyTitle}>
        <Text style={styles.title}>{copy.days.energyTitle}</Text>
        {ordered.length === 0 ? (
          <Text style={styles.empty}>{copy.days.energyEmpty}</Text>
        ) : (
          ordered.map((log) => (
            <Text key={log.id} style={styles.item}>
              {formatHm(log.loggedAt, zone)} {labelOf(log)}
            </Text>
          ))
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap} accessibilityLabel={copy.today.energyTitle}>
      <View style={styles.row}>
        <Text style={styles.markLabel}>{copy.today.energyMark}</Text>
        <View style={styles.levels} accessibilityRole="radiogroup">
          {LEVELS.map((level) => {
            const on = latest?.energy === level;
            return (
              <Pressable
                key={level}
                accessibilityRole="button"
                accessibilityLabel={copy.today.energyLevel.replace('{n}', String(level))}
                accessibilityState={{ selected: on }}
                disabled={busy}
                onPress={() => void save(level)}
                style={[styles.level, on ? styles.levelOn : styles.levelIdle, busy ? styles.dim : null]}
              >
                <Text style={[styles.levelText, on ? styles.levelTextOn : null]}>{level}</Text>
              </Pressable>
            );
          })}
        </View>
        {latestQuiet !== '' ? <Text style={styles.latest}>{latestQuiet}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => setDetail((open) => !open)}>
          <Text style={styles.detailToggle}>{detail ? copy.today.energyDetailClose : copy.today.energyDetail}</Text>
        </Pressable>
      </View>
      {detail ? (
        <View>
          <Text style={styles.hint}>{copy.today.energyHint}</Text>
          <View style={styles.moods}>
            {copy.today.energyMoods.map((word) => {
              const on = mood === word;
              return (
                <Pressable
                  key={word}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  disabled={busy}
                  onPress={() => setMood(on ? null : word)}
                  style={[styles.mood, on ? styles.moodOn : null]}
                >
                  <Text style={[styles.moodText, on ? styles.moodTextOn : null]}>{word}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={200}
            placeholder={copy.today.energyNote}
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel={copy.today.energyNote}
            style={styles.note}
          />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {earlier.map((log) => (
        <Text key={log.id} style={styles.item}>
          {formatHm(log.loggedAt, zone)} {labelOf(log)}
        </Text>
      ))}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 16, paddingBottom: 4 },
    title: { color: t.fgPrimary, fontSize: 15, fontWeight: '600' },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    markLabel: { color: t.textTertiary, fontSize: 13 },
    latest: { color: t.fgMuted, fontSize: 13 },
    detailToggle: { color: t.textTertiary, fontSize: 13 },
    hint: { color: t.textTertiary, fontSize: 12, marginTop: 8 },
    levels: { flexDirection: 'row', gap: 6 },
    level: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    levelIdle: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.borderSubtle },
    levelOn: { backgroundColor: t.accentPrimary },
    levelText: { color: t.fgPrimary, fontSize: 14, fontWeight: '600' },
    levelTextOn: { color: t.fgOnAccent },
    dim: { opacity: 0.5 },
    moods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    mood: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: t.bgSurfaceMuted,
    },
    moodOn: { backgroundColor: t.bgAccentSubtle },
    moodText: { color: t.fgMuted, fontSize: 13 },
    moodTextOn: { color: t.accentDeep, fontWeight: '600' },
    note: {
      marginTop: 10,
      borderRadius: 8,
      backgroundColor: t.bgSurface,
      color: t.fgPrimary,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    error: { color: t.danger, fontSize: 12, marginTop: 8 },
    empty: { color: t.textTertiary, fontSize: 12, marginTop: 8 },
    item: { color: t.fgMuted, fontSize: 13, marginTop: 6 },
  });
}
