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

  return (
    <View style={styles.wrap} accessibilityLabel={readOnly ? copy.days.energyTitle : copy.today.energyTitle}>
      <Text style={styles.title}>{readOnly ? copy.days.energyTitle : copy.today.energyTitle}</Text>
      {readOnly ? null : <Text style={styles.hint}>{copy.today.energyHint}</Text>}
      {readOnly ? null : (
        <View style={styles.levels} accessibilityRole="radiogroup">
          {LEVELS.map((level) => (
            <Pressable
              key={level}
              accessibilityRole="button"
              accessibilityLabel={copy.today.energyLevel.replace('{n}', String(level))}
              disabled={busy}
              onPress={() => void save(level)}
              style={[styles.level, level <= 2 ? styles.levelLow : styles.levelOk, busy ? styles.dim : null]}
            >
              <Text style={styles.levelText}>{level}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {readOnly ? null : (
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
      )}
      {readOnly ? null : (
        <TextInput
          value={note}
          onChangeText={setNote}
          maxLength={200}
          placeholder={copy.today.energyNote}
          placeholderTextColor={theme.textTertiary}
          accessibilityLabel={copy.today.energyNote}
          style={styles.note}
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {items.length === 0 ? (
        <Text style={styles.empty}>{copy.days.energyEmpty}</Text>
      ) : (
        items.map((log) => (
          <Text key={log.id} style={styles.item}>
            {formatHm(log.loggedAt, zone)} {labelOf(log)}
          </Text>
        ))
      )}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 16, paddingBottom: 8 },
    title: { color: t.fgPrimary, fontSize: 15, fontWeight: '600' },
    hint: { color: t.textTertiary, fontSize: 12, marginTop: 2 },
    levels: { flexDirection: 'row', gap: 8, marginTop: 10 },
    level: {
      minWidth: 36,
      height: 36,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    levelLow: { backgroundColor: t.bgSurfaceMuted },
    levelOk: { backgroundColor: t.bgAccentSubtle },
    levelText: { color: t.fgPrimary, fontSize: 15, fontWeight: '600' },
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
