import { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { splitForRender } from '@vital/markdown';
import type { ReportEmbeds, TaskStatus } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { chipLabel } from '../features/reports/chip-label';
import { renderPartsToLines } from '../features/reports/split-lines';
import { useTheme } from '../theme/use-theme';
import { EntityChip } from './EntityChip';

export function ReportMarkdown({
  bodyMd,
  embeds,
  onToggleTask,
  onOpenInbox,
}: {
  bodyMd: string;
  embeds: ReportEmbeds;
  onToggleTask?: (id: string, status: TaskStatus) => void;
  onOpenInbox?: (id: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const lines = useMemo(() => renderPartsToLines(splitForRender(bodyMd)), [bodyMd]);

  return (
    <View style={styles.wrap}>
      {lines.map((line, li) => (
        <View key={li} style={styles.line}>
          {line.length === 0 ? <Text style={styles.body}> </Text> : null}
          {line.map((part, pi) => {
            if (part.type === 'text') {
              return (
                <Text key={pi} style={textStyle(part.value, styles)}>
                  {part.value}
                </Text>
              );
            }
            const { token } = part;
            const label = chipLabel(token, embeds);
            const status = token.kind === 'task' ? embeds.tasks[token.id]?.status : undefined;
            return (
              <EntityChip
                key={`${token.kind}:${token.id}:${String(pi)}`}
                kind={token.kind}
                label={label}
                status={status}
                onPress={() => {
                  if (token.kind === 'task' && status !== undefined) {
                    onToggleTask?.(token.id, status);
                  } else if (token.kind === 'inbox') {
                    onOpenInbox?.(token.id);
                  }
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

function textStyle(value: string, styles: ReturnType<typeof createStyles>): TextStyle {
  if (value.startsWith('# ')) return styles.h1;
  if (value.startsWith('## ')) return styles.h2;
  if (value.startsWith('### ')) return styles.h3;
  return styles.body;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space[1] },
    line: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: t.space[1],
      minHeight: 24.5,
    },
    body: {
      fontSize: t.type.body.fontSize,
      lineHeight: 24.5,
      color: t.fgPrimary,
    },
    h1: {
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
    h2: {
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
    h3: {
      fontSize: t.type.meta.fontSize,
      lineHeight: t.type.meta.lineHeight,
      fontWeight: '600',
      color: t.fgPrimary,
    },
  });
