import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer, useService } from '@rabjs/react';
import { Calendar, CalendarDays, CheckSquare, Inbox, Plus, Sun } from 'lucide-react-native';
import type { List } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { Icon, type LucideIcon } from '../../ui/icon';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SMART_ORDER, listLabel } from './list-meta';
import { TodosService } from './todos.service';

const ICONS: Record<string, LucideIcon> = {
  'smart:today': Sun,
  'smart:inbox': Inbox,
  'smart:upcoming': CalendarDays,
  'smart:someday': Calendar,
  'smart:done': CheckSquare,
};

export const ListDrawer = observer(function ListDrawer() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(TodosService);
  const { width: screenW } = useWindowDimensions();
  const drawerW = Math.min(360, Math.round(screenW * 0.86));
  const [translateX] = useState(() => new Animated.Value(-drawerW));
  const lists = s.lists;
  const listId = s.listId;
  const counts = s.counts;
  const manageTarget = s.manageTarget;
  const listDraft = s.listDraft;
  const smartRows = SMART_ORDER.map((id) => lists.find((row) => row.id === id)).filter(
    (row): row is List => row !== undefined,
  );
  const userLists = lists.filter((row) => row.kind === 'user' && !row.isArchived);

  useEffect(() => {
    if (!s.drawer) return;
    translateX.setValue(-drawerW);
    const id = requestAnimationFrame(() => {
      Animated.timing(translateX, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
    return () => cancelAnimationFrame(id);
  }, [s.drawer, drawerW, translateX]);

  function row(list: List): ReactElement {
    const active = list.id === listId;
    const Glyph = ICONS[list.id];
    const n = counts[list.id] ?? 0;
    const manageable = list.kind === 'user';
    return (
      <Pressable
        key={list.id}
        accessibilityRole="button"
        onPress={() => s.selectList(list.id)}
        onLongPress={manageable ? () => s.openManage(list) : undefined}
        delayLongPress={320}
        style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.rowPressed]}
      >
        {Glyph ? <Icon icon={Glyph} size={20} color={active ? t.accentPrimary : t.fgMuted} /> : (
          <View style={styles.dot} />
        )}
        <Text style={[styles.name, active && styles.nameActive]} numberOfLines={1}>
          {listLabel(list)}
        </Text>
        {n > 0 ? <Text style={styles.count}>{n}</Text> : null}
      </Pressable>
    );
  }

  if (!s.drawer) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => s.closeDrawer()}>
      <View style={styles.root}>
        <Pressable style={[styles.scrim, { backgroundColor: t.scrim }]} onPress={() => s.closeDrawer()} />
        <Animated.View style={[styles.drawer, { width: drawerW, transform: [{ translateX }] }]}>
          <SafeAreaView style={styles.drawerInner} edges={['top', 'left']}>
            <Text style={styles.kicker}>{copy.todos.smartLists}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {smartRows.map(row)}
              <Text style={styles.kicker}>{copy.todos.userLists}</Text>
              {userLists.length === 0 ? (
                <Text style={styles.empty}>{copy.empty.userList}</Text>
              ) : (
                userLists.map(row)
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => s.openListCreate()}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Icon icon={Plus} size={20} color={t.accentPrimary} />
                <Text style={styles.newList} numberOfLines={1}>
                  {copy.todos.newList}
                </Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </View>
      <PickerSheet
        visible={manageTarget !== null}
        title={manageTarget ? listLabel(manageTarget) : ''}
        onClose={() => s.closeManage()}
      >
        {manageTarget ? (
          <View>
            <PickerOption
              label={copy.todos.renameList}
              onPress={() => s.openListRename(manageTarget)}
            />
            <PickerOption
              label={copy.todos.archiveList}
              onPress={() => {
                const target = manageTarget;
                s.closeManage();
                void s.archiveList(target);
              }}
            />
            <PickerOption
              label={copy.todos.deleteList}
              destructive
              onPress={() => {
                const target = manageTarget;
                s.closeManage();
                void s.deleteList(target);
              }}
            />
          </View>
        ) : null}
      </PickerSheet>
      <BottomSheet visible={listDraft !== null} onClose={() => s.closeListDraft()}>
        <View style={styles.compose}>
          <Text style={styles.composeTitle}>
            {listDraft?.mode === 'rename' ? copy.todos.renameList : copy.todos.newList}
          </Text>
          <Field
            placeholder={copy.todos.listNamePlaceholder}
            value={s.listDraftName}
            onChangeText={(name) => s.setListDraftName(name)}
            onSubmitEditing={() => void s.submitListDraft()}
            returnKeyType="done"
            autoFocus
          />
          <Button
            size="lg"
            loading={s.listDraftBusy}
            disabled={s.listDraftName.trim() === ''}
            onPress={() => void s.submitListDraft()}
          >
            {copy.actions.save}
          </Button>
        </View>
      </BottomSheet>
    </Modal>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, flexDirection: 'row' },
    scrim: { ...StyleSheet.absoluteFillObject },
    drawer: {
      height: '100%',
      backgroundColor: t.bgElevated,
    },
    drawerInner: { flex: 1, paddingHorizontal: t.space[3], paddingBottom: t.space[8] },
    kicker: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      color: t.textTertiary,
      letterSpacing: 1,
      paddingHorizontal: t.space[3],
      paddingTop: t.space[4],
      paddingBottom: t.space[2],
    },
    row: {
      minHeight: t.space[12],
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      paddingHorizontal: t.space[3],
      borderRadius: t.radius.md,
    },
    rowActive: { backgroundColor: t.bgAccentSubtle },
    rowPressed: { backgroundColor: t.bgSurfaceMuted },
    name: { flex: 1, minWidth: 0, fontSize: t.type.body.fontSize, color: t.fgPrimary },
    nameActive: { fontWeight: '600' },
    newList: {
      flex: 1,
      minWidth: 0,
      fontSize: t.type.body.fontSize,
      fontWeight: '500',
      color: t.accentPrimary,
    },
    count: {
      fontSize: t.type.meta.fontSize,
      color: t.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.accentPrimary,
    },
    empty: {
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[3],
      fontSize: t.type.meta.fontSize,
      color: t.fgMuted,
    },
    compose: {
      paddingHorizontal: t.space[4],
      paddingTop: t.space[2],
      gap: t.space[3],
    },
    composeTitle: {
      fontSize: t.type.section.fontSize,
      lineHeight: t.type.section.lineHeight,
      fontWeight: '600',
      color: t.fgPrimary,
    },
  });
