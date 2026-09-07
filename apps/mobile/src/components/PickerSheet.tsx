import { useMemo, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import { useTheme } from '../theme/use-theme';

export function PickerSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={copy.actions.cancel} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={styles.done}>{copy.todos.dateDone}</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: t.scrim,
    },
    sheet: {
      maxHeight: '78%',
      backgroundColor: t.bgElevated,
      borderTopLeftRadius: t.radius.lg,
      borderTopRightRadius: t.radius.lg,
      paddingHorizontal: t.space[4],
      paddingTop: t.space[4],
      paddingBottom: t.space[8],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: t.space[3],
    },
    title: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgPrimary },
    done: { fontSize: t.type.meta.fontSize, color: t.accentPrimary, fontWeight: '600' },
  });
