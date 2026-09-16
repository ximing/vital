import type { List, Tag, Task } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type FC } from 'react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import { useScrollVirtualizer, virtualItemStyle } from '@/ui/use-scroll-virtualizer';
import { EmptyTasks } from './EmptyTasks';
import {
  flattenNodes,
  formatHumanDay,
  listSections,
  listTitle,
  orderedAfterDrop,
  siblingIds,
  type ListSection,
} from './model';
import { TaskRow } from './TaskRow';
import { TodosUiService } from './todos-ui.service';

function GroupHeading({
  children,
  count,
  tone,
  first,
  collapsed,
  onToggle,
  action,
}: {
  children: string;
  count: number;
  tone?: 'overdue' | 'pinned' | 'muted';
  first?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`group/heading flex items-center gap-1 px-2 pb-2 ${first ? 'pt-2' : 'pt-6'}`}>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className={`eyebrow eyebrow-rule min-w-0 flex-1 rounded text-left ${
          tone === 'overdue' ? 'eyebrow-danger' : tone === 'pinned' ? 'eyebrow-accent' : ''
        }`}
      >
        <Icon
          icon={collapsed ? ChevronRight : ChevronDown}
          size={12}
          className="shrink-0 opacity-70"
        />
        {tone === 'pinned' ? (
          <Icon icon={Pin} size={11} className="shrink-0" fill="currentColor" />
        ) : null}
        <span className="truncate">{children}</span>
        <span className="shrink-0 font-mono font-normal normal-case tracking-normal tabular-nums opacity-80">
          {count}
        </span>
      </button>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 rounded px-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted hover:text-accent"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function sectionTitle(section: ListSection, timeZone: string): string | null {
  if (section.heading === 'pinned') return t.todos.pinned;
  if (section.heading === 'overdue') return t.todos.overdue;
  if (section.heading === 'today') return t.lists.today;
  if (section.heading === 'done') return t.lists.done;
  if (section.heading === 'list') return section.listName ?? t.todos.thisList;
  if (section.heading === 'day' && section.ymd) return formatHumanDay(section.ymd, timeZone);
  return null;
}

type ListVirtualRow =
  | {
      key: string;
      kind: 'heading';
      section: ListSection;
      heading: string;
      count: number;
      first: boolean;
      collapsed: boolean;
    }
  | { key: string; kind: 'task'; task: Task; depth: 0 | 1 };

function flattenListRows(
  sections: ListSection[],
  collapsed: ReadonlySet<string>,
  timeZone: string,
): ListVirtualRow[] {
  const rows: ListVirtualRow[] = [];
  sections.forEach((section, index) => {
    const heading = sectionTitle(section, timeZone);
    const flat = flattenNodes(section.nodes);
    const isCollapsed = collapsed.has(section.key);
    if (heading) {
      rows.push({
        key: `h:${section.key}`,
        kind: 'heading',
        section,
        heading,
        count: flat.length,
        first: index === 0,
        collapsed: isCollapsed,
      });
    }
    if (!isCollapsed) {
      for (const node of flat) {
        rows.push({ key: `t:${node.task.id}`, kind: 'task', task: node.task, depth: node.depth });
      }
    }
  });
  return rows;
}

function estimateListRow(row: ListVirtualRow): number {
  if (row.kind === 'heading') return row.first ? 40 : 56;
  return 52;
}

export const ListView: FC<{
  listId: string;
  tasks: Task[];
  tags: Tag[];
  lists: List[];
  timeZone: string;
  doneScope?: boolean;
  onComplete: (task: Task) => void;
  onReorder: (input: { listId: string; parentId: string | null; orderedIds: string[] }) => void;
  onPostpone?: (tasks: Task[]) => void;
  onTaskMenu?: (task: Task, x: number, y: number) => void;
}> = observer(function ListView({
  listId,
  tasks,
  tags,
  lists,
  timeZone,
  doneScope = false,
  onComplete,
  onReorder,
  onPostpone,
  onTaskMenu,
}: {
  listId: string;
  tasks: Task[];
  tags: Tag[];
  lists: List[];
  timeZone: string;
  doneScope?: boolean;
  onComplete: (task: Task) => void;
  onReorder: (input: { listId: string; parentId: string | null; orderedIds: string[] }) => void;
  onPostpone?: (tasks: Task[]) => void;
  onTaskMenu?: (task: Task, x: number, y: number) => void;
}) {
  const todos = useService(TodosUiService);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const sections = useMemo(
    () => listSections(listId, tasks, timeZone, undefined, lists, todos.taskSort),
    [listId, tasks, timeZone, lists, todos.taskSort],
  );
  const rows = useMemo(
    () => flattenListRows(sections, collapsed, timeZone),
    [sections, collapsed, timeZone],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const { listRef, virtualizer } = useScrollVirtualizer({ rows, estimateSize: estimateListRow });

  useEffect(() => {
    const id = todos.selectedId;
    if (!id) return;
    const index = rowsRef.current.findIndex((row) => row.kind === 'task' && row.task.id === id);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [todos.selectedId, virtualizer]);

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, task: Task) {
    event.dataTransfer.setData('text/plain', task.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, target: Task) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');
    if (draggedId === '' || draggedId === target.id) return;
    const dragged = tasks.find((item) => item.id === draggedId);
    if (!dragged || dragged.listId !== target.listId || dragged.parentId !== target.parentId)
      return;
    const ids = siblingIds(tasks, target.listId, target.parentId);
    const next = orderedAfterDrop(ids, draggedId, target.id, 'before');
    if (next.join() === ids.join()) return;
    onReorder({ listId: target.listId, parentId: target.parentId, orderedIds: next });
  }

  if (tasks.length === 0) return <EmptyTasks listId={listId} kind="list" done={doneScope} />;

  const manualSort = todos.taskSort.key === 'manual';
  const boxLabel =
    listId === 'smart:today'
      ? t.lists.today
      : listId === 'smart:upcoming'
        ? t.lists.upcoming
        : t.nav.todos;
  const scrollMargin = virtualizer.options.scrollMargin;

  return (
    <div ref={listRef} role="listbox" aria-label={boxLabel}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={virtualItemStyle(virtualRow.start, scrollMargin)}
            >
              {row.kind === 'heading' ? (
                <GroupHeading
                  count={row.count}
                  first={row.first}
                  collapsed={row.collapsed}
                  onToggle={() => toggleSection(row.section.key)}
                  tone={
                    row.section.heading === 'overdue'
                      ? 'overdue'
                      : row.section.heading === 'pinned'
                        ? 'pinned'
                        : 'muted'
                  }
                  action={
                    row.section.heading === 'overdue' && onPostpone
                      ? {
                          label: t.todos.postpone,
                          onClick: () =>
                            onPostpone(flattenNodes(row.section.nodes).map((node) => node.task)),
                        }
                      : undefined
                  }
                >
                  {row.heading}
                </GroupHeading>
              ) : (
                <TaskRow
                  task={row.task}
                  depth={row.depth}
                  selected={todos.selectedId === row.task.id}
                  timeZone={timeZone}
                  tags={tags}
                  listName={
                    listId.startsWith('smart:') && listId !== 'smart:inbox'
                      ? listTitle(row.task.listId, lists, '')
                      : undefined
                  }
                  onSelect={() => todos.openDetail(row.task.id)}
                  onOpen={() => todos.openDetail(row.task.id)}
                  onComplete={() => onComplete(row.task)}
                  onDragStart={
                    manualSort ? (event) => handleDragStart(event, row.task) : undefined
                  }
                  onDragOver={manualSort ? handleDragOver : undefined}
                  onDrop={manualSort ? (event) => handleDrop(event, row.task) : undefined}
                  onContextMenu={
                    onTaskMenu
                      ? (event) => {
                          event.preventDefault();
                          onTaskMenu(row.task, event.clientX, event.clientY);
                        }
                      : undefined
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
