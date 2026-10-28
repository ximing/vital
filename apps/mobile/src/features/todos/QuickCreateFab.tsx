import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { ArrowUp, Plus } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { BottomSheet } from '../../components/BottomSheet';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { markOnboarding } from '../../lib/onboarding';
import { pullSync } from '../../lib/sync';
import { useAuth } from '../../services/auth.service';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { Icon } from '../../ui/icon';
import { composeTaskRequest } from './compose-task';

/**
 * 全局新建任务（对齐 web 的 ⌘N / C 浮窗）：今天/待办 tab 已有自己的创作入口，
 * FAB 只出现在收集、回顾、我的三个 tab，点开 BottomSheet 直接写任务，
 * 默认落收集箱；配了模型时一句话解析日期与优先级（smart:today 兜底）。
 */
export function GlobalCreateFab() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(t), [t]);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const show = pathname === '/inbox' || pathname === '/reports' || pathname === '/me';
  const tabBarH = t.space[12] + Math.max(insets.bottom, t.space[5]);
  return (
    <>
      {show ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.todos.quickCreateTitle}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.fab,
            rnShadow(t),
            { bottom: tabBarH + 20 },
            pressed && styles.fabPressed,
          ]}
        >
          <Icon icon={Plus} color={t.fgOnAccent} size={26} />
        </Pressable>
      ) : null}
      <QuickCreateSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function QuickCreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const tz = auth.user?.timezone ?? 'UTC';

  async function submit(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    try {
      const inboxId = await client
        .listLists()
        .then((res) => res.items.find((row) => row.kind === 'inbox')?.id);
      if (!inboxId) return;
      const request = composeTaskRequest({
        text: trimmed,
        listId: inboxId,
        timezone: tz,
        llm: auth.user?.llm,
        due: { source: 'preset' },
        priority: null,
        tagIds: [],
        smartListId: 'smart:today',
      });
      const task =
        request.kind === 'text'
          ? await client.createTaskFromText(request.body)
          : await client.createTask(request.body);
      void task;
      await markOnboarding(auth.user, auth.refreshUser, { createdTask: true });
      setTitle('');
      onClose();
      void pullSync().catch(() => undefined);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} openFull>
      <View style={styles.sheet}>
        <Text style={styles.eyebrow}>{copy.todos.quickCreateTitle}</Text>
        <View style={styles.row}>
          <TextInput
            autoFocus
            value={title}
            onChangeText={setTitle}
            placeholder={copy.todos.addTaskPlaceholder}
            placeholderTextColor={t.fgMuted}
            editable={!busy}
            style={styles.input}
            accessibilityLabel={copy.todos.addTaskPlaceholder}
            onSubmitEditing={() => void submit()}
            returnKeyType="done"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.todos.quickCreateTitle}
            disabled={busy || title.trim() === ''}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.send,
              (busy || title.trim() === '') && styles.sendDisabled,
              pressed && styles.fabPressed,
            ]}
          >
            <Icon icon={ArrowUp} color={t.fgOnAccent} size={18} />
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    // spec §f：56×56 accent 圆 FAB，tab bar 上沿再抬 20。
    fab: {
      position: 'absolute',
      right: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.accentPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
    },
    fabPressed: { backgroundColor: t.accentPrimaryHover },
    sheet: { paddingHorizontal: t.space[4], gap: t.space[3] },
    eyebrow: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      letterSpacing: 1,
      color: t.textTertiary,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    input: {
      flex: 1,
      minWidth: 0,
      height: 44,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space[3],
      backgroundColor: t.bgSurfaceMuted,
      color: t.fgPrimary,
      fontSize: t.type.body.fontSize,
    },
    send: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.accentPrimary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendDisabled: { opacity: 0.4 },
  });
