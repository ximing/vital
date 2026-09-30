export const inboxKeys = {
  all: ['inbox'] as const,
  list: ['inbox', 'list'] as const,
  extractJobs: (page: number) => ['inbox', 'extract-jobs', page] as const,
  item: (id: string) => ['inbox', 'item', id] as const,
};
