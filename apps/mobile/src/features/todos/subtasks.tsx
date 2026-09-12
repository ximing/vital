import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import type { Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';

/** 子任务勾选框：详情页 20px / 浮层沿用同款。 */
export function SubtaskCheckbox({ row, onToggle }: { row: Task; onToggle: (row: Task) => void }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const done = row.status === 'done';
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={row.title}
      hitSlop={t.space[2]}
      onPress={() => onToggle(row)}
      style={[styles.check, done && styles.checkDone]}
    >
      {done ? <Text style={styles.checkMark}>✓</Text> : null}
    </Pressable>
  );
}

/** spec §c 子任务行：checkbox 20 + 标题 14/500；完成态 fgMuted 删除线。 */
export function SubtaskRow({ row, onToggle }: { row: Task; onToggle: (row: Task) => void }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const done = row.status === 'done';
  return (
    <View style={styles.row}>
      <SubtaskCheckbox row={row} onToggle={onToggle} />
      <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
        {row.title}
      </Text>
    </View>
  );
}

/** 「+ 添加子任务」行：点击展开行内输入，回车提交创建。openToken 变化时自动展开（工具条入口用）。 */
export function AddSubtaskRow({
  onAdd,
  openToken,
}: {
  onAdd: (title: string) => Promise<void>;
  openToken?: number;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // openToken 变化时展开输入（render 期间比对上次的 token，派生态调整，避免 effect 级联）。
  const [seenToken, setSeenToken] = useState(openToken ?? 0);
  if (openToken !== undefined && openToken > seenToken) {
    setSeenToken(openToken);
    setOpen(true);
  }

  async function submit(): Promise<void> {
    const name = draft.trim();
    if (name === '') {
      setOpen(false);
      return;
    }
    await onAdd(name);
    setDraft('');
  }

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        hitSlop={t.space[1]}
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
      >
        <Plus size={16} strokeWidth={2.2} color={t.accentPrimary} />
        <Text style={styles.addLabel}>{copy.todos.addSubtask}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.inputRow}>
      <TextInput
        autoFocus
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => void submit()}
        onBlur={() => {
          if (draft.trim() === '') setOpen(false);
        }}
        placeholder={copy.todos.addSubtask}
        placeholderTextColor={t.textTertiary}
        returnKeyType="done"
        style={styles.input}
      />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 7,
      paddingHorizontal: t.space[1],
    },
    check: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: t.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkDone: { backgroundColor: t.statusDone, borderColor: t.statusDone },
    checkMark: { color: t.fgOnAccent, fontSize: 11, fontWeight: '700' },
    title: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20, fontWeight: '500', color: t.fgPrimary },
    titleDone: { color: t.fgMuted, textDecorationLine: 'line-through' },
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      paddingVertical: t.space[2],
      paddingHorizontal: t.space[1],
    },
    pressed: { opacity: 0.7 },
    addLabel: { fontSize: 14, fontWeight: '500', color: t.accentPrimary },
    inputRow: { paddingVertical: t.space[1] },
    input: {
      minHeight: t.controlH,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      fontSize: 14,
      color: t.fgPrimary,
      backgroundColor: t.bgSurfaceMuted,
    },
  });
