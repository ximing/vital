export const todoKeys = {
  all: ['todos'] as const,
  lists: ['todos', 'lists'] as const,
  tags: ['todos', 'tags'] as const,
  counts: ['todos', 'counts'] as const,
  tasksRoot: ['todos', 'tasks'] as const,
  tasks: (listId: string) => ['todos', 'tasks', listId] as const,
  item: (id: string) => ['todos', 'task', id] as const,
  calendarRoot: ['todos', 'calendar'] as const,
  calendar: (from: string, to: string) => ['todos', 'calendar', from, to] as const,
};
