export const inboxKeys = {
  all: ['inbox'] as const,
  list: ['inbox', 'list'] as const,
  item: (id: string) => ['inbox', 'item', id] as const,
};
