import type { Tag, Task } from '@vital/dto';
import type { DragEvent } from 'react';
import { t } from '@/copy';
import { EmptyTasks } from './EmptyTasks';
import {
  flattenNodes,
  formatHumanDay,
  groupByDay,
  nestTasks,
  orderedAfterDrop,
  partitionToday,
  siblingIds,
} from './model';
import { TaskRow } from './TaskRow';
import { useTodosUi } from './ui-store';

function GroupHeading({ children, tone }: { children: string; tone?: 'overdue' | 'muted' }) {
  return (
    <h2
      className={`px-3 pb-1 pt-4 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] ${
        tone === 'overdue' ? 'text-overdue' : 'text-muted'
      }`}
    >
      {children}
    </h2>
  );
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
  const setSelected = useTodosUi((s) => s.setSelected);
  const openDetail = useTodosUi((s) => s.openDetail);

  const nodes = nestTasks(tasks);
  const openNodes = nestTasks(
    tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled'),
  );
  const doneNodes = nestTasks(tasks.filter((task) => task.status === 'done'));

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

  function renderNodeList(list: ReturnType<typeof nestTasks>) {
    return flattenNodes(list).map(({ task, depth }) => (
      <TaskRow
        key={task.id}
        task={task}
        depth={depth}
        selected={selectedId === task.id}
        timeZone={timeZone}
        tags={tags}
        onSelect={() => setSelected(task.id)}
        onOpen={() => openDetail(task.id)}
        onComplete={() => onComplete(task)}
        onDragStart={(event) => handleDragStart(event, task)}
        onDragOver={handleDragOver}
        onDrop={(event) => handleDrop(event, task)}
      />
    ));
  }

  if (tasks.length === 0) return <EmptyTasks listId={listId} kind="list" />;

  if (listId === 'smart:today') {
    const { overdue, today } = partitionToday(openNodes, timeZone);
    return (
      <div role="listbox" aria-label={t.lists.today}>
        {overdue.length > 0 ? (
          <section>
            <GroupHeading tone="overdue">{t.todos.overdue}</GroupHeading>
            {renderNodeList(overdue)}
          </section>
        ) : null}
        {today.length > 0 ? (
          <section>
            <GroupHeading>{t.lists.today}</GroupHeading>
            {renderNodeList(today)}
          </section>
        ) : null}
      </div>
    );
  }

  if (listId === 'smart:upcoming') {
    const groups = groupByDay(openNodes, timeZone);
    return (
      <div role="listbox" aria-label={t.lists.upcoming}>
        {groups.map((group) => (
          <section key={group.ymd || 'undated'}>
            <GroupHeading>
              {group.ymd === '' ? t.lists.anytime : formatHumanDay(group.ymd, timeZone)}
            </GroupHeading>
            {renderNodeList(group.nodes)}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div role="listbox" aria-label={t.nav.todos}>
      {renderNodeList(
        listId.startsWith('smart:') ? openNodes : nodes.filter((n) => n.task.status !== 'done'),
      )}
      {doneNodes.length > 0 && !listId.startsWith('smart:') ? (
        <section>
          <GroupHeading>{t.lists.done}</GroupHeading>
          {renderNodeList(doneNodes)}
        </section>
      ) : null}
      {listId === 'smart:done' ? renderNodeList(doneNodes) : null}
    </div>
  );
}
