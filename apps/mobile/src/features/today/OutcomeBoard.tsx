import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MessagesSquare } from 'lucide-react-native';
import type { Outcome } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { OutcomeCard } from './OutcomeCard';
import { sortOutcomes } from './model';

/**
 * 新建线程表单：输入框对齐 Field 规格（h44 bgSurfaceMuted radius 10 padding 12，无描边），
 * 提交为 primary sm 按钮。
 */
function CreateOutcomeForm({
  onCreate,
  onDone,
}: {
  onCreate: (name: string) => Promise<void>;
  onDone?: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const next = name.trim();
    if (next === '' || busy) return;
    setBusy(true);
    try {
      await onCreate(next.slice(0, 120));
      setName('');
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={copy.today.newOutcomePlaceholder}
        placeholderTextColor={t.textTertiary}
        maxLength={120}
        style={styles.input}
        onSubmitEditing={() => void submit()}
        returnKeyType="done"
      />
      <Button
        variant="primary"
        size="sm"
        loading={busy}
        disabled={name.trim() === ''}
        onPress={() => void submit()}
      >
        {copy.today.create}
      </Button>
    </View>
  );
}

export function OutcomeBoard({
  outcomes,
  now,
  onCreate,
  onClose,
  onReopen,
  onUndo,
  onRetry,
}: {
  outcomes: Outcome[];
  now: Date;
  onCreate: (name: string) => Promise<void>;
  onClose: (id: string) => void;
  onReopen: (id: string) => void;
  onUndo: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [creating, setCreating] = useState(false);

  return (
    <View>
      <SectionHead
        title={copy.today.board}
        count={outcomes.length}
        right={
          <Pressable
            accessibilityRole="button"
            onPress={() => setCreating((open) => !open)}
            hitSlop={8}
          >
            <Text style={styles.headLink}>{copy.today.newOutcome}</Text>
          </Pressable>
        }
      />
      {creating ? (
        <View style={styles.createWrap}>
          <CreateOutcomeForm onCreate={onCreate} onDone={() => setCreating(false)} />
        </View>
      ) : null}
      {outcomes.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={copy.today.emptyTitle}
          hint={copy.today.emptyHint}
          action={{ label: copy.today.newOutcome, onPress: () => setCreating(true) }}
        />
      ) : (
        <View style={styles.list}>
          {sortOutcomes(outcomes).map((outcome) => (
            <OutcomeCard
              key={outcome.id}
              outcome={outcome}
              now={now}
              onClose={() => onClose(outcome.id)}
              onReopen={() => onReopen(outcome.id)}
              onUndo={() => onUndo(outcome.id)}
              onRetry={() => onRetry(outcome.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    headLink: { fontSize: t.type.caption.fontSize, fontWeight: '500', color: t.accentPrimary },
    createWrap: { marginBottom: t.space[3] },
    form: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
    },
    input: {
      flex: 1,
      minWidth: 0,
      height: 44,
      borderRadius: 10,
      backgroundColor: t.bgSurfaceMuted,
      paddingHorizontal: t.space[3],
      fontSize: t.type.body.fontSize,
      color: t.fgPrimary,
    },
    list: { marginTop: t.space[1], gap: t.space[3] },
  });
