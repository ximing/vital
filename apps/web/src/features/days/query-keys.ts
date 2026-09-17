export const dayKeys = {
  all: ['days'] as const,
  list: ['days', 'list'] as const,
  catalog: ['days', 'catalog'] as const,
  meta: (year: number) => ['days', 'meta', year] as const,
};
