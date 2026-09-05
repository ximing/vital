import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { InboxItem } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { htmlToText, looksLikeMarkdown } from '../lib/html';
import { useTheme } from '../theme/use-theme';

export function InboxReader({ item }: { item: InboxItem }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const text = item.extractedText?.trim()
    ? item.extractedText
    : item.extractedHtml
      ? htmlToText(item.extractedHtml)
      : (item.excerpt ?? '');
  const markdown = looksLikeMarkdown(text);
  const blocks = markdown ? text.split(/\n\n+/) : [text];

  return (
    <View style={styles.wrap}>
      {blocks.map((block, i) => {
        const first = (block.split('\n')[0] ?? '').trimEnd();
        if (first.startsWith('### ')) {
          return (
            <Text key={i} style={styles.h3}>
              {first.slice(4)}
            </Text>
          );
        }
        if (first.startsWith('## ')) {
          return (
            <Text key={i} style={styles.h2}>
              {first.slice(3)}
            </Text>
          );
        }
        if (first.startsWith('# ')) {
          return (
            <Text key={i} style={styles.h1}>
              {first.slice(2)}
            </Text>
          );
        }
        return (
          <Text key={i} style={styles.body}>
            {block}
          </Text>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space[3] },
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
      fontWeight: '600',
      color: t.fgPrimary,
    },
    body: {
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      color: t.fgPrimary,
    },
  });
