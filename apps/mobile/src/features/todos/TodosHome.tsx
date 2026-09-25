import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import type { Task } from '@vital/dto';
import {
  ArrowUpDown,
  CalendarDays,
  CheckSquare,
  Columns3,
  Ellipsis,
  FolderCog,
  List as ListIcon,
  Menu,
  Pin,
} from 'lucide-react-native';
import type { Theme } from '@vital/tokens';
import { Banner } from '../../components/Banner';
import { IconButton } from '../../components/IconButton';
import { PageHeader } from '../../components/PageHeader';
import { PickerOption, PickerSection, PickerSheet } from '../../components/PickerSheet';
import { SearchIconButton } from '../../components/SearchIconButton';
import { useOpenTask } from '../../components/TaskSheetHost';
import { copy } from '../../lib/copy';
import {
  startOfLocalDayIso,
  TASK_SORT_KEYS,
  type TaskSort,
  type TaskSortKey,
} from '../../lib/format';
import { useFocusReload } from '../../hooks/use-focus-reload';
import { useTheme } from '../../theme/use-theme';
import { ListDrawer } from './ListDrawer';
import { TaskList } from './TaskList';
import { emptyCopy, isSmartList, listLabel, titleCopy, type TaskListView } from './list-meta';
import { TaskListService } from './task-list.service';
import { TodosService } from './todos.service';

const SORT_LABEL: Record<TaskSortKey, string> = {
  manual: copy.todos.sortManual,
  created: copy.todos.sortCreated,
  updated: copy.todos.sortUpdated,
  due: copy.todos.sortDue,
  title: copy.todos.sortTitle,
};

function sortHint(sort: TaskSort, key: TaskSortKey): string {
  if (sort.key !== key || key === 'manual') return '';
  if (key === 'title') return sort.dir === 'asc' ? 'A → Z' : 'Z → A';
  if (key === 'due') return sort.dir === 'asc' ? copy.todos.sortSoonest : copy.todos.sortLatest;
  return sort.dir === 'desc' ? copy.todos.sortNewest : copy.todos.sortOldest;
}

const TodosHomeContent = observer(function TodosHomeContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(TodosService);
  const list = useService(TaskListService);
  const openTask = useOpenTask();
  useEffect(() => {
    s.start();
    return () => s.stop();
  }, [s]);
  useFocusReload(useCallback(() => s.load(), [s]));
  const tz = s.tz;
  const headerTitle = s.current ? listLabel(s.current) : titleCopy(s.listId);

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
        grouped
        view={s.view}
        onViewChange={(view: TaskListView) => s.setView(view)}
        onOpenTask={(task: Task) => openTask(task.id)}
        onPostponeOverdue={() => void s.postponeOverdue()}
        onOverdueCount={(count: number) => s.setOverdueCount(count)}
      />
      <ListDrawer />
      <PickerSheet visible={s.more} title={copy.todos.more} onClose={() => s.closeMore()}>
        <PickerSection first label={copy.todos.viewMenu} />
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
        <PickerSection label={copy.todos.sort} />
        {TASK_SORT_KEYS.map((key) => {
          const active = list.taskSort.key === key;
          const hint = sortHint(list.taskSort, key);
          return (
            <PickerOption
              key={key}
              icon={ArrowUpDown}
              label={hint ? `${SORT_LABEL[key]} · ${hint}` : SORT_LABEL[key]}
              selected={active}
              onPress={() => list.setTaskSortKey(key)}
            />
          );
        })}
        <PickerSection label={copy.todos.listMenu} />
        {s.current?.kind === 'user' ? (
          <PickerOption
            icon={Pin}
            label={s.current.pinned ? copy.todos.unpin : copy.todos.pin}
            onPress={() => {
              const list = s.current;
              if (!list) return;
              s.closeMore();
              void s.pinList(list);
            }}
          />
        ) : null}
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
  });
