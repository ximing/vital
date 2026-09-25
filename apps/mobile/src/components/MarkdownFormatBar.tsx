import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
} from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import type { FormatAction } from '../lib/markdown-format';
import { useTheme } from '../theme/use-theme';
import { Icon, type LucideIcon } from '../ui/icon';

const ACTIONS: { action: FormatAction; icon: LucideIcon; label: string }[] = [
  { action: 'h2', icon: Heading2, label: copy.format.h2 },
  { action: 'h3', icon: Heading3, label: copy.format.h3 },
  { action: 'bold', icon: Bold, label: copy.format.bold },
  { action: 'italic', icon: Italic, label: copy.format.italic },
  { action: 'strike', icon: Strikethrough, label: copy.format.strike },
  { action: 'code', icon: Code, label: copy.format.code },
  { action: 'bullet', icon: List, label: copy.format.bullet },
  { action: 'ordered', icon: ListOrdered, label: copy.format.ordered },
  { action: 'quote', icon: Quote, label: copy.format.quote },
  { action: 'codeBlock', icon: SquareCode, label: copy.format.codeBlock },
  { action: 'link', icon: LinkIcon, label: copy.format.link },
];

/** Compact format row. Touching it freezes the editor selection so the button still sees the range. */
export function MarkdownFormatBar({
  onTouchFormat,
  onApply,
  onComposerChange,
  onDismiss,
}: {
  onTouchFormat: () => void;
  onApply: (action: FormatAction, href?: string) => void;
  onComposerChange?: (open: boolean) => void;
  onDismiss?: (reason: 'cancel' | 'blur') => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [link, setLink] = useState<string | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (blurTimer.current !== null) clearTimeout(blurTimer.current);
    },
    [],
  );

  function clearBlur(): void {
    if (blurTimer.current !== null) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  }

  function closeLink(reason: 'apply' | 'cancel' | 'blur'): void {
    clearBlur();
    const href = (link ?? '').trim();
    setLink(null);
    onComposerChange?.(false);
    if (reason === 'apply' && href !== '' && href !== 'https://') {
      onApply('link', href);
      return;
    }
    onDismiss?.(reason === 'blur' ? 'blur' : 'cancel');
  }

  return (
    <View onTouchStart={onTouchFormat}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {ACTIONS.map((item) => (
          <Pressable
            key={item.action}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPressIn={onTouchFormat}
            onPress={() => {
              if (item.action === 'link') {
                setLink('https://');
                onComposerChange?.(true);
                return;
              }
              onApply(item.action);
            }}
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          >
            <Icon icon={item.icon} size={16} color={t.fgMuted} />
          </Pressable>
        ))}
      </ScrollView>
      {link !== null ? (
        <View style={styles.linkRow}>
          <TextInput
            value={link}
            onChangeText={setLink}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={copy.format.linkPrompt}
            placeholderTextColor={t.textTertiary}
            style={styles.linkInput}
            onBlur={() => {
              clearBlur();
              blurTimer.current = setTimeout(() => closeLink('blur'), 200);
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.actions.cancel}
            onPressIn={() => {
              onTouchFormat();
              clearBlur();
            }}
            onPress={() => closeLink('cancel')}
          >
            <Text style={styles.linkCancel}>{copy.actions.cancel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.actions.add}
            onPressIn={() => {
              onTouchFormat();
              clearBlur();
            }}
            onPress={() => closeLink('apply')}
          >
            <Text style={styles.linkOk}>{copy.actions.add}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
    btn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.sm,
    },
    pressed: { backgroundColor: t.bgSurfaceMuted },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: t.space[2], marginBottom: t.space[1] },
    linkInput: {
      flex: 1,
      minHeight: 36,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      backgroundColor: t.bgSurfaceMuted,
      color: t.fgPrimary,
      fontSize: 14,
    },
    linkCancel: { color: t.fgMuted, fontSize: 14, fontWeight: '600' },
    linkOk: { color: t.accentPrimary, fontSize: 14, fontWeight: '600' },
  });
