import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CreateHabitInput } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { habitTemplateInputs } from './model';

/**
 * 习惯空态模板卡（spec §f.5）：无活跃习惯时替代车道，虚线描边浅卡 + 一键模板 pills。
 */
export function HabitEmptyCard({
  onEnable,
}: {
  onEnable: (input: CreateHabitInput) => Promise<void>;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [pending, setPending] = useState<string | null>(null);
  const templates = habitTemplateInputs();

  async function enable(template: CreateHabitInput): Promise<void> {
    if (pending !== null) return;
    setPending(template.name);
    try {
      await onEnable(template);
    } finally {
      setPending(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{copy.today.habitEmptyTitle}</Text>
      <Text style={styles.hint}>{copy.today.habitEmptyHint}</Text>
      <View style={styles.pills}>
        {templates.map((template) => (
          <Pressable
            key={template.name}
            accessibilityRole="button"
            disabled={pending !== null}
            onPress={() => void enable(template)}
            style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
          >
            <Text style={styles.pillLabel}>{template.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[3],
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: t.borderSubtle,
      backgroundColor: t.bgSurface,
      gap: t.space[2],
    },
    title: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    hint: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    pill: {
      height: 28,
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: t.space[3],
      justifyContent: 'center',
    },
    pressed: { opacity: 0.7 },
    pillLabel: { fontSize: t.type.caption.fontSize, fontWeight: '500', color: t.accentPrimary },
  });
