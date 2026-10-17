import { WEEKLY_GOALS_HEADING, WEEKLY_INSIGHT_HEADING } from '@vital/dto';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../../theme/use-theme';

const H2 = /^## /;

/** Body of one `## heading`, cut at the next H2. Blank when the heading is missing or empty. */
export function extractH2Section(bodyMd: string, heading: string): string {
  const marker = `## ${heading}`;
  const idx = bodyMd.indexOf(marker);
  if (idx < 0) return '';
  const afterHeading = bodyMd.slice(idx + marker.length);
  const afterLines = afterHeading.startsWith('\n') ? afterHeading.slice(1) : afterHeading;
  const lines = afterLines.split('\n');
  const cut = lines.findIndex((line) => H2.test(line));
  const kept = cut >= 0 ? lines.slice(0, cut) : lines;
  return kept.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/** Read-only. The report editor only binds 复盘 and must not absorb these sections. */
export function WeeklyReadouts({ bodyMd }: { bodyMd: string }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const blocks = [
    { heading: WEEKLY_INSIGHT_HEADING, text: extractH2Section(bodyMd, WEEKLY_INSIGHT_HEADING) },
    { heading: WEEKLY_GOALS_HEADING, text: extractH2Section(bodyMd, WEEKLY_GOALS_HEADING) },
  ].filter((block) => block.text.trim().length > 0);
  if (blocks.length === 0) return null;
  return (
    <View>
      {blocks.map((block) => (
        <View key={block.heading} style={styles.block}>
          <Text style={styles.heading}>{block.heading}</Text>
          <Text style={styles.body}>{block.text}</Text>
        </View>
      ))}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    block: { paddingHorizontal: t.space[4], paddingTop: t.space[4], gap: t.space[2] },
    heading: { fontSize: 12, fontWeight: '600', letterSpacing: 1, color: t.textTertiary },
    body: { fontSize: t.type.body.fontSize, lineHeight: 24, color: t.fgPrimary },
  });
