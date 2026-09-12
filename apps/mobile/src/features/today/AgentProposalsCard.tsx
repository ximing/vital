import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { observer, useService } from '@rabjs/react';
import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import type { AgentActionLogItem } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { pendingProposals } from './model';
import { TodayService } from './today.service';

function detailText(item: AgentActionLogItem): string {
  const summary = item.payloadSummary.trim();
  if (item.targetName !== null) {
    return summary === '' ? item.targetName : `${item.targetName}：${summary}`;
  }
  return summary === '' ? copy.settings.activity.deletedTarget : summary;
}

/**
 * spec §f.6 Agent 提案卡：eyebrow「AGENT 提案」accent + 计数，右侧「全部」→ /activity。
 * 白卡内提案行：✨ icon 16 fgMuted + 文案 14/21 + 行尾 quiet「采纳」accent /「忽略」tertiary，
 * 多提案 hairline 分隔。采纳/忽略走 sendAgentActionFeedback（onSettle）。
 */
export const AgentProposalsCard = observer(function AgentProposalsCard() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(TodayService);
  const proposals = s.proposals;
  const busyId = s.settleBusyId;
  const shown = pendingProposals(proposals);
  if (proposals.length === 0) return null;

  return (
    <View testID="agent-proposals" style={styles.wrap}>
      <SectionHead
        title={copy.today.agentProposals.title}
        count={proposals.length}
        tone="accent"
        right={
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/activity')}
            hitSlop={8}
          >
            <Text style={styles.all}>{copy.today.agentProposals.all}</Text>
          </Pressable>
        }
      />
      <View style={[styles.card, rnShadow(t)]}>
        {shown.map((item, index) => (
          <View
            key={item.id}
            style={[styles.row, index < shown.length - 1 && styles.rowBorder]}
          >
            <Icon icon={Sparkles} size={16} strokeWidth={1.7} color={t.fgMuted} />
            <Text style={styles.title} numberOfLines={2}>
              {detailText(item)}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={busyId !== null}
              onPress={() => void s.settleProposal(item.id, 'accepted')}
              hitSlop={8}
            >
              <Text style={styles.accept}>{copy.settings.activity.accept}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busyId !== null}
              onPress={() => void s.settleProposal(item.id, 'dismissed')}
              hitSlop={8}
            >
              <Text style={styles.dismiss}>{copy.settings.activity.dismiss}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: t.space[4] },
    all: { fontSize: t.type.caption.fontSize, fontWeight: '500', color: t.accentPrimary },
    card: {
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      paddingHorizontal: t.space[4],
      paddingVertical: t.space[2],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: t.space[2],
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borderSubtle,
    },
    title: {
      flex: 1,
      minWidth: 0,
      fontSize: 14,
      lineHeight: 21,
      color: t.fgPrimary,
    },
    accept: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.accentPrimary },
    dismiss: { fontSize: t.type.meta.fontSize, color: t.textTertiary },
  });
