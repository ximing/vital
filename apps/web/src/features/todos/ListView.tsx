import type { Tag, Task } from '@vital/dto';
import type { DragEvent } from 'react';
import { t } from '@/copy';
import { EmptyTasks } from './EmptyTasks';
import {
  flattenNodes,
  formatHumanDay,
  listSections,
  orderedAfterDrop,
  siblingIds,
  type ListSection,
} from './model';
import { TaskRow } from './TaskRow';
import { useTodosUi } from './todos-ui.service';

function GroupHeading({ children, tone }: { children: string; tone?: 'overdue' | 'muted' }) {
  return (
    <h2
      className={`px-3 pb-1.5 pt-6 text-[length:var(--text-caption)] font-medium leading-[var(--text-caption-lh)] ${
        tone === 'overdue' ? 'text-overdue' : 'text-muted'
      }`}
    >
      {children}
    </h2>
  );
}

function sectionTitle(section: ListSection, timeZone: string): string | null {
  if (section.heading === 'overdue') return t.todos.overdue;
  if (section.heading === 'today') return t.lists.today;
  if (section.heading === 'done') return t.lists.done;
  if (section.heading === 'anytime') return t.lists.anytime;
  if (section.heading === 'day' && section.ymd) return formatHumanDay(section.ymd, timeZone);
  return null;
}

export function ListView({
  listId,
  tasks,
  tags,
  timeZone,
  onComplete,
  onReorder,
}: {
  listId: string;
  tasks: Task[];
  tags: Tag[];
  timeZone: string;
  onComplete: (task: Task) => void;
  onReorder: (input: { listId: string; parentId: string | null; orderedIds: string[] }) => void;
}) {
  const selectedId = useTodosUi((s) => s.selectedId);
  const openDetail = useTodosUi((s) => s.openDetail);

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
        selected={selectedId === task.id}
        timeZone={timeZone}
        tags={tags}
        onSelect={() => openDetail(task.id)}
        onOpen={() => openDetail(task.id)}
        onComplete={() => onComplete(task)}
        onDragStart={(event) => handleDragStart(event, task)}
        onDragOver={handleDragOver}
        onDrop={(event) => handleDrop(event, task)}
      />
    ));
  }

  if (tasks.length === 0) return <EmptyTasks listId={listId} kind="list" />;

  const sections = listSections(listId, tasks, timeZone);
  const boxLabel =
    listId === 'smart:today'
      ? t.lists.today
      : listId === 'smart:upcoming'
        ? t.lists.upcoming
        : t.nav.todos;

  return (
    <div role="listbox" aria-label={boxLabel}>
      {sections.map((section) => {
        const heading = sectionTitle(section, timeZone);
        return (
          <section key={section.key}>
            {heading ? (
              <GroupHeading tone={section.heading === 'overdue' ? 'overdue' : 'muted'}>
                {heading}
              </GroupHeading>
            ) : null}
            {renderNodeList(section.nodes)}
          </section>
        );
      })}
    </div>
  );
}
