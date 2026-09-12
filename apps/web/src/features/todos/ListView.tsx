import type { List, Tag, Task } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import { useState, type DragEvent, type FC } from 'react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
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
    <div
      className={`group/heading flex items-center gap-1 px-2 pb-2 ${
        first ? 'pt-2' : 'pt-6'
      }`}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className={`eyebrow eyebrow-rule min-w-0 flex-1 rounded text-left ${
          tone === 'overdue'
            ? 'eyebrow-danger'
            : tone === 'pinned'
              ? 'eyebrow-accent'
              : ''
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

export const ListView: FC<{
  listId: string;
  tasks: Task[];
  tags: Tag[];
  lists: List[];
  timeZone: string;
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
  onComplete: (task: Task) => void;
  onReorder: (input: { listId: string; parentId: string | null; orderedIds: string[] }) => void;
  onPostpone?: (tasks: Task[]) => void;
  onTaskMenu?: (task: Task, x: number, y: number) => void;
}) {
  const todos = useService(TodosUiService);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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

  function renderNodeList(list: ListSection['nodes']) {
    return flattenNodes(list).map(({ task, depth }) => (
      <TaskRow
        key={task.id}
        task={task}
        depth={depth}
        selected={todos.selectedId === task.id}
        timeZone={timeZone}
        tags={tags}
        listName={
          listId.startsWith('smart:') && listId !== 'smart:inbox'
            ? listTitle(task.listId, lists, '')
            : undefined
        }
        onSelect={() => todos.openDetail(task.id)}
        onOpen={() => todos.openDetail(task.id)}
        onComplete={() => onComplete(task)}
        onDragStart={(event) => handleDragStart(event, task)}
        onDragOver={handleDragOver}
        onDrop={(event) => handleDrop(event, task)}
        onContextMenu={
          onTaskMenu
            ? (event) => {
                event.preventDefault();
                onTaskMenu(task, event.clientX, event.clientY);
              }
            : undefined
        }
      />
    ));
  }

  if (tasks.length === 0) return <EmptyTasks listId={listId} kind="list" />;

  const sections = listSections(listId, tasks, timeZone, undefined, lists);
  const boxLabel =
    listId === 'smart:today'
      ? t.lists.today
      : listId === 'smart:upcoming'
        ? t.lists.upcoming
        : t.nav.todos;

  return (
    <div role="listbox" aria-label={boxLabel}>
      {sections.map((section, index) => {
        const heading = sectionTitle(section, timeZone);
        const isCollapsed = collapsed.has(section.key);
        const flat = flattenNodes(section.nodes);
        return (
          <section key={section.key}>
            {heading ? (
              <GroupHeading
                count={flat.length}
                first={index === 0}
                collapsed={isCollapsed}
                onToggle={() => toggleSection(section.key)}
                tone={
                  section.heading === 'overdue'
                    ? 'overdue'
                    : section.heading === 'pinned'
                      ? 'pinned'
                      : 'muted'
                }
                action={
                  section.heading === 'overdue' && onPostpone
                    ? {
                        label: t.todos.postpone,
                        onClick: () => onPostpone(flat.map((node) => node.task)),
                      }
                    : undefined
                }
              >
                {heading}
              </GroupHeading>
            ) : null}
            {isCollapsed ? null : renderNodeList(section.nodes)}
          </section>
        );
      })}
    </div>
  );
});
