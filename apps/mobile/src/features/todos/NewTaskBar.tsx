import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { llmReady, type CreateTaskInput, type Task } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../services/auth.service';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { markOnboarding } from '../../lib/onboarding';
import { useTheme } from '../../theme/use-theme';
import { Icon } from '../../ui/icon';
import { rnShadow } from '../../ui/card';
import { toast } from '../../components/toast';

/**
 * spec §2a 新建输入条：h48 白底 pill + 1px borderSubtle + rnShadow，左侧 plus 图标，
 * placeholder「添加任务」，returnKey 提交。贴 tab bar 上沿（由父级布局位置决定）。
 */
export function NewTaskBar({
  listId,
  extra,
  onCreated,
}: {
  listId: string;
  extra?: Partial<CreateTaskInput>;
  onCreated: (task: Task) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    try {
      const task = llmReady(auth.user?.llm)
        ? await client.createTaskFromText({
            text: trimmed,
            listId,
            ...(auth.user?.timezone ? { timezone: auth.user.timezone } : {}),
            ...(extra?.status === 'doing' || extra?.status === 'todo'
              ? { status: extra.status }
              : {}),
            ...(extra?.priority !== undefined ? { priority: extra.priority } : {}),
          })
        : await client.createTask({ title: trimmed, listId, ...extra });
      setTitle('');
      onCreated(task);
      await markOnboarding(auth.user, auth.refreshUser, { createdTask: true });
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.pill}>
        <Icon icon={Plus} size={20} color={t.textTertiary} />
        <TextInput
          style={styles.input}
          placeholder={copy.todos.addTaskPlaceholder}
          placeholderTextColor={t.textTertiary}
          value={title}
          onChangeText={setTitle}
          editable={!busy}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          autoCapitalize="none"
        />
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: {
      paddingHorizontal: t.space[4],
      paddingBottom: t.space[3],
    },
    pill: {
      height: t.space[12],
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.borderSubtle,
      backgroundColor: t.bgElevated,
      ...rnShadow(t),
    },
    input: {
      flex: 1,
      minWidth: 0,
      fontSize: t.type.body.fontSize,
      color: t.fgPrimary,
    },
  });
