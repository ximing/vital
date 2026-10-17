export const energyKeys = {
  all: ['energy-logs'] as const,
  day: (date: string) => ['energy-logs', date] as const,
};
