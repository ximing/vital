import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { Field } from '../../components/Field';

function NotesPreview({ md, styles }: { md: string; styles: ReturnType<typeof createStyles> }) {
  const lines = md.length === 0 ? [] : md.split('\n');
  if (lines.length === 0) {
    return <Text style={styles.placeholder}>{copy.todos.notesPlaceholder}</Text>;
  }
  return (
    <View style={styles.preview}>
      {lines.map((line, i) => {
        if (line.startsWith('# ')) {
          return (
            <Text key={i} style={styles.h1}>
              {line.slice(2)}
            </Text>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <Text key={i} style={styles.h2}>
              {line.slice(3)}
            </Text>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <Text key={i} style={styles.body}>
              • {line.slice(2)}
            </Text>
          );
        }
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
          return (
            <Text key={i} style={styles.bold}>
              {line.slice(2, -2)}
            </Text>
          );
        }
        return (
          <Text key={i} style={styles.body}>
            {line === '' ? ' ' : line}
          </Text>
        );
      })}
    </View>
  );
}

export function NotesField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [editing, setEditing] = useState(value.length === 0);

  function apply(wrap: 'bold' | 'h2' | 'list') {
    if (wrap === 'bold') {
      onChange(value.length === 0 ? '****' : `**${value}**`);
      return;
    }
    if (wrap === 'h2') {
      const next = value.length === 0 ? '## ' : `## ${value.replace(/^#{1,3}\s+/, '')}`;
      onChange(next);
      return;
    }
    const lines = (value.length === 0 ? [''] : value.split('\n')).map((line) =>
      line.startsWith('- ') ? line : `- ${line}`,
    );
    onChange(lines.join('\n'));
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>{copy.todos.notes}</Text>
        {editing ? (
          <View style={styles.tools}>
            <Pressable style={styles.tool} onPress={() => apply('bold')}>
              <Text style={styles.toolLabel}>粗体</Text>
            </Pressable>
            <Pressable style={styles.tool} onPress={() => apply('h2')}>
              <Text style={styles.toolLabel}>小标题</Text>
            </Pressable>
            <Pressable style={styles.tool} onPress={() => apply('list')}>
              <Text style={styles.toolLabel}>列表</Text>
            </Pressable>
            {value.length > 0 ? (
              <Pressable style={styles.tool} onPress={() => setEditing(false)}>
                <Text style={styles.toolLabel}>{copy.actions.done}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Pressable style={styles.tool} onPress={() => setEditing(true)}>
            <Text style={styles.toolLabel}>{copy.actions.edit}</Text>
          </Pressable>
        )}
      </View>
      {editing ? (
        <Field
          value={value}
          onChangeText={onChange}
          placeholder={copy.todos.notesPlaceholder}
          multiline
          autoCapitalize="sentences"
        />
      ) : (
        <Pressable onPress={() => setEditing(true)}>
          <NotesPreview md={value} styles={styles} />
        </Pressable>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space[2] },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: t.space[2],
    },
    label: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    tools: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[1] },
    tool: {
      minHeight: t.space[8],
      paddingHorizontal: t.space[2],
      borderRadius: t.radius.pill,
      backgroundColor: t.bgSurfaceMuted,
      justifyContent: 'center',
    },
    toolLabel: { fontSize: t.type.caption.fontSize, color: t.fgPrimary },
    preview: {
      minHeight: t.space[12] * 2,
      padding: t.space[3],
      borderRadius: t.radius.lg,
      backgroundColor: t.bgSurfaceMuted,
      gap: t.space[1],
    },
    placeholder: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    h1: { fontSize: t.type.title.fontSize, fontWeight: '700', color: t.fgPrimary },
    h2: { fontSize: t.type.body.fontSize, fontWeight: '600', color: t.fgPrimary },
    bold: { fontSize: t.type.body.fontSize, fontWeight: '700', color: t.fgPrimary },
    body: { fontSize: t.type.body.fontSize, color: t.fgPrimary, lineHeight: t.type.body.lineHeight },
  });
