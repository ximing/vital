import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MarkdownDoc } from '../../components/MarkdownDoc';
import { MarkdownFormatBar } from '../../components/MarkdownFormatBar';
import { copy } from '../../lib/copy';
import { useFormatSession } from '../../lib/format-session';
import { applyMarkdownFormat } from '../../lib/markdown-format';
import { useTheme } from '../../theme/use-theme';

/** Task notes: formatted preview until tapped, then a text field with the same marks the web editor writes. */
export function NotesField({
  value,
  full,
  onChange,
  onCommit,
  onEditStart,
}: {
  value: string;
  full: boolean;
  onChange: (next: string) => void;
  onCommit: () => void;
  onEditStart?: () => void;
}) {
  const t = useTheme();
  const inputRef = useRef<TextInput>(null);
  const session = useFormatSession();
  const [editing, setEditing] = useState(false);

  function apply(action: Parameters<typeof applyMarkdownFormat>[2], href?: string): void {
    session.cancelLeave();
    const next = applyMarkdownFormat(value, session.getSelection(), action, href);
    onChange(next.value);
    session.setSelection(next.selection);
    session.setForced(next.selection);
    inputRef.current?.focus();
  }

  function leave(): void {
    setEditing(false);
    onCommit();
  }

  if (!editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.todos.notes}
        onPress={() => {
          session.setSelection({ start: value.length, end: value.length });
          onEditStart?.();
          setEditing(true);
        }}
        style={[styles.preview, full ? styles.full : styles.half]}
      >
        {value.trim() === '' ? (
          <Text style={{ fontSize: 14, lineHeight: 21, color: t.textTertiary }}>{copy.todos.addNotes}</Text>
        ) : (
          <MarkdownDoc markdown={value} />
        )}
      </Pressable>
    );
  }

  return (
    <View>
      <MarkdownFormatBar
        onTouchFormat={session.beginHold}
        onComposerChange={session.setPinned}
        onApply={apply}
        onDismiss={(reason) => {
          if (reason === 'blur') {
            session.scheduleLeave(leave);
            return;
          }
          session.cancelLeave();
          inputRef.current?.focus();
        }}
      />
      <TextInput
        ref={inputRef}
        value={value}
        selection={session.forced ?? undefined}
        onSelectionChange={(event) => {
          if (session.holding()) return;
          session.setSelection(event.nativeEvent.selection);
          if (session.forced) session.setForced(null);
        }}
        onChangeText={onChange}
        onFocus={session.cancelLeave}
        onBlur={() => session.scheduleLeave(leave)}
        autoFocus
        multiline
        scrollEnabled={full}
        textAlignVertical="top"
        style={[styles.input, full ? styles.full : styles.half, { color: t.fgMuted }]}
        placeholder={copy.todos.addNotes}
        placeholderTextColor={t.textTertiary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { marginTop: 2 },
  input: { fontSize: 14, lineHeight: 21, padding: 0 },
  half: { maxHeight: 96 },
  full: { minHeight: 120 },
});
