import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AgentActionLogItem } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function detailText(item: AgentActionLogItem): string {
  const summary = item.payloadSummary.trim();
  if (item.targetName !== null) {
    return summary === '' ? item.targetName : `${item.targetName}：${summary}`;
  }
  return summary === '' ? copy.activity.deletedTarget : summary;
}

export function proposalFullText(item: AgentActionLogItem): string {
  const payload = item.payload ?? {};
  const str = (key: string) => payloadString(payload, key);
  let body = '';
  switch (item.actionType) {
    case 'task.draft':
      body = str('draft');
      break;
    case 'report.generate':
      body = str('notes');
      break;
    case 'outcome.headline':
      body = str('headline');
      break;
    case 'outcome.suggestion':
      body = str('suggestion');
      break;
    case 'outcome.create':
      body = str('name');
      break;
    case 'task.decompose': {
      const subtasks = Array.isArray(payload['subtasks']) ? payload['subtasks'] : [];
      body = subtasks
        .map((entry) =>
          entry && typeof entry === 'object'
            ? payloadString(entry as Record<string, unknown>, 'title')
            : '',
        )
        .filter((title) => title !== '')
        .map((title, index) => `${index + 1}. ${title}`)
        .join('\n');
      break;
    }
    default:
      body = str('content') || str('hint') || str('name');
  }
  if (body === '') return detailText(item);
  if (item.targetName !== null && item.targetName !== body) {
    return `${item.targetName}\n${body}`;
  }
  return body;
}

export function ExpandableProposalText({
  item,
  muted = false,
}: {
  item: AgentActionLogItem;
  muted?: boolean;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [open, setOpen] = useState(false);
  // The toggle only exists when the FULL body needs more than 2 lines —
  // measured on a hidden unclamped copy at real width, not a length heuristic.
  const [overflow, setOverflow] = useState(false);
  const full = proposalFullText(item);
  const text = open ? full : detailText(item);

  return (
    <View style={styles.wrap}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        pointerEvents="none"
        style={[styles.body, muted && styles.muted, styles.measure]}
        onTextLayout={(event) => setOverflow(event.nativeEvent.lines.length > 2)}
      >
        {full}
      </Text>
      <Text style={[styles.body, muted && styles.muted]} numberOfLines={open ? undefined : 2}>
        {text}
      </Text>
      {open || overflow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          hitSlop={8}
        >
          <Text style={styles.toggle}>{open ? copy.activity.collapse : copy.activity.expand}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { flex: 1, minWidth: 0 },
    measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
    body: { fontSize: 14, lineHeight: 21, color: t.fgPrimary, fontWeight: '500' },
    muted: { color: t.fgMuted, fontWeight: '400' },
    toggle: {
      marginTop: 2,
      fontSize: t.type.caption.fontSize,
      fontWeight: '500',
      color: t.accentPrimary,
    },
  });
