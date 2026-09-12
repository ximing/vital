import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { InboxItem } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { htmlToText, looksLikeMarkdown } from '../lib/html';
import { useTheme } from '../theme/use-theme';
import { READER_FONT_STEPS, type ReaderFontSize } from '../ui/reader-font';

export function InboxReader({ item, size = 'md' }: { item: InboxItem; size?: ReaderFontSize }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const step = READER_FONT_STEPS[size];
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
        if (first.startsWith('> ')) {
          const quote = block
            .split('\n')
            .map((line) => line.replace(/^>\s?/, ''))
            .join('\n');
          return (
            <View key={i} style={styles.quote}>
              <Text style={[styles.body, styles.quoteText, step]}>{quote}</Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[styles.body, step]}>
            {block}
          </Text>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space[4] },
    h1: {
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
    h2: {
      fontSize: t.type.section.fontSize,
      lineHeight: t.type.section.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
    h3: {
      fontSize: t.type.meta.fontSize,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    body: {
      color: t.fgPrimary,
    },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: t.accentPrimary,
      paddingLeft: t.space[3],
    },
    quoteText: { color: t.fgMuted },
  });
