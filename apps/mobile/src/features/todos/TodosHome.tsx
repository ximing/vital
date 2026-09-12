import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import type { Task } from '@vital/dto';
import { CalendarDays, CheckSquare, Columns3, Ellipsis, FolderCog, List as ListIcon, Menu, Plus } from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { IconButton } from '../../components/IconButton';
import { PageHeader } from '../../components/PageHeader';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { SearchIconButton } from '../../components/SearchIconButton';
import { useOpenTask } from '../../components/TaskSheetHost';
import { copy } from '../../lib/copy';
import { startOfLocalDayIso } from '../../lib/format';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { Icon } from '../../ui/icon';
import { rnShadow } from '../../ui/card';
import { ListDrawer } from './ListDrawer';
import { NewTaskBar } from './NewTaskBar';
import { TaskList } from './TaskList';
import { emptyCopy, isSmartList, listLabel, titleCopy, type TaskListView } from './list-meta';
import { TodosService } from './todos.service';

const TodosHomeContent = observer(function TodosHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const s = useService(TodosService);
  const openTask = useOpenTask();
  useFocusReload(useCallback(() => s.load(), [s]));
  const tz = s.tz;
  const headerTitle = s.current ? listLabel(s.current) : titleCopy(s.listId);
  const createId = isSmartList(s.listId) ? s.inboxId : s.listId;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <PageHeader
        title={headerTitle}
        leading={
          <IconButton icon={Menu} label={copy.todos.switchList} onPress={() => s.openDrawer()} />
        }
        trailing={
          <>
            <SearchIconButton />
            <IconButton icon={Ellipsis} label={copy.todos.more} onPress={() => s.openMore()} />
          </>
        }
      />
      {s.error ? (
        <Banner tone="error" action={{ label: copy.actions.retry, onPress: () => void s.load() }}>
          {s.error}
        </Banner>
      ) : null}
      <TaskList
        key={`${s.listId}:${s.listEpoch}`}
        listId={s.listId}
        empty={emptyCopy(s.listId)}
        createListId={isSmartList(s.listId) ? undefined : s.listId}
        createFromInbox={isSmartList(s.listId)}
        createExtra={
          s.listId === 'smart:today'
            ? { dueAt: startOfLocalDayIso(tz), isAllDay: true, timezone: tz }
            : undefined
        }
        showViews={false}
        hideComposer
        grouped
        view={s.view}
        onViewChange={(view: TaskListView) => s.setView(view)}
        onOpenTask={(task: Task) => openTask(task.id)}
        onPostponeOverdue={() => void s.postponeOverdue()}
        onOverdueCount={(count: number) => s.setOverdueCount(count)}
      />
      {s.compose && createId ? (
        <NewTaskBar
          listId={createId}
          extra={
            s.listId === 'smart:today'
              ? { dueAt: startOfLocalDayIso(tz), isAllDay: true, timezone: tz }
              : undefined
          }
          onCreated={() => {
            s.closeCompose();
            s.bumpList();
            void s.load();
          }}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.actions.add}
          onPress={() => s.openCompose()}
          style={({ pressed }) => [
            styles.fab,
            { bottom: Math.max(insets.bottom, t.space[5]) + t.space[12] + t.space[5] },
            pressed && styles.fabPressed,
          ]}
        >
          <Icon icon={Plus} size={26} color={t.fgOnAccent} />
        </Pressable>
      )}
      <ListDrawer />
      <PickerSheet visible={s.more} title={copy.todos.more} onClose={() => s.closeMore()}>
        <PickerOption
          icon={ListIcon}
          label={copy.todos.views.list}
          selected={s.view === 'list'}
          onPress={() => s.setView('list')}
        />
        <PickerOption
          icon={Columns3}
          label={copy.todos.views.board}
          selected={s.view === 'board'}
          onPress={() => s.setView('board')}
        />
        <PickerOption
          icon={CalendarDays}
          label={copy.todos.views.week}
          selected={s.view === 'week'}
          onPress={() => s.setView('week')}
        />
        <PickerOption
          icon={CheckSquare}
          label={copy.todos.showDone}
          onPress={() => s.selectList('smart:done')}
        />
        {s.overdueCount > 0 ? (
          <PickerOption
            label={copy.today.postponeAll}
            onPress={() => {
              s.closeMore();
              void s.postponeOverdue();
            }}
          />
        ) : null}
        <PickerOption
          icon={FolderCog}
          label={copy.todos.manageLists}
          onPress={() => {
            s.closeMore();
            s.openDrawer();
          }}
        />
      </PickerSheet>
    </SafeAreaView>
  );
});

export const TodosHome = bindServices(TodosHomeContent, [TodosService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    fab: {
      position: 'absolute',
      right: t.space[5],
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.accentPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      ...rnShadow(t),
      shadowRadius: 12,
    },
    fabPressed: { backgroundColor: t.accentPrimaryHover },
  });
