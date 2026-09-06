import type {
  Report,
  ReportCollection,
  ReportEmbeds,
  ReportListItem,
  ReportType,
  SearchHit,
} from '@vital/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { markOnboarding } from '@/features/onboarding/mark';
import type { SlashHit } from './model';

export const reportKeys = {
  all: ['reports'] as const,
  list: (type: ReportType) => ['reports', 'list', type] as const,
  current: (type: ReportType) => ['reports', 'current', type] as const,
  item: (id: string) => ['reports', 'item', id] as const,
};

async function fetchAllReports(type: ReportType): Promise<ReportListItem[]> {
  const items: ReportListItem[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const page: ReportCollection = await client.listReports({ type, cursor, limit: 100 });
    items.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return items;
}

export function useReportListQuery(type: ReportType) {
  return useQuery({
    queryKey: reportKeys.list(type),
    queryFn: () => fetchAllReports(type),
  });
}

export function useCurrentReportQuery(type: ReportType, enabled = true) {
  return useQuery({
    queryKey: reportKeys.current(type),
    queryFn: () => client.getCurrentReport(type),
    enabled,
  });
}

export function useReportQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: reportKeys.item(id),
    queryFn: () => client.getReport(id),
    enabled: enabled && id !== '',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useReportActions() {
  const qc = useQueryClient();

  function cacheReport(report: Report, asCurrent = false): void {
    qc.setQueryData(reportKeys.item(report.id), report);
    if (asCurrent) qc.setQueryData(reportKeys.current(report.type), report);
  }

  const fill = useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      client.fillReport(id, { revision }),
    onSuccess: (report) => {
      cacheReport(report);
      void qc.invalidateQueries({ queryKey: reportKeys.list(report.type) });
      void qc.invalidateQueries({ queryKey: reportKeys.current(report.type) });
    },
  });

  async function markWroteDaily(type: ReportType): Promise<void> {
    if (type === 'weekly') await markOnboarding({ openedWeekly: true });
    if (type !== 'daily') return;
    await markOnboarding({ wroteDaily: true });
  }

  async function save(id: string, input: { revision: number; bodyMd?: string; title?: string }) {
    const report = await client.patchReport(id, input);
    cacheReport(report);
    void qc.invalidateQueries({ queryKey: reportKeys.list(report.type) });
    await markWroteDaily(report.type);
    return report;
  }

  async function loadCurrent(type: ReportType, at?: string): Promise<Report> {
    const report = await client.getCurrentReport(type, at);
    cacheReport(report, at === undefined);
    return report;
  }

  async function loadReport(id: string): Promise<Report> {
    const report = await client.getReport(id);
    cacheReport(report);
    return report;
  }

  async function loadEmbeds(id: string): Promise<{ revision: number; embeds: ReportEmbeds }> {
    return client.getReportEmbeds(id);
  }

  return { fill, save, loadCurrent, loadReport, loadEmbeds, cacheReport };
}

function hitsFromSearch(items: SearchHit[]): SlashHit[] {
  const out: SlashHit[] = [];
  for (const hit of items) {
    if (hit.type === 'task') out.push({ kind: 'task', id: hit.task.id, title: hit.task.title });
    if (hit.type === 'inbox') out.push({ kind: 'inbox', id: hit.inbox.id, title: hit.inbox.title });
  }
  return out;
}

export async function searchSlashHits(query: string): Promise<SlashHit[]> {
  const q = query.trim();
  if (q === '') {
    const [tasks, inbox] = await Promise.all([
      client.listTasks({ listId: 'smart:today', limit: 10 }),
      client.listInbox({ limit: 10 }),
    ]);
    return [
      ...tasks.items.map((task) => ({ kind: 'task' as const, id: task.id, title: task.title })),
      ...inbox.items.map((item) => ({ kind: 'inbox' as const, id: item.id, title: item.title })),
    ];
  }
  const res = await client.search({ q, types: ['task', 'inbox'], limit: 20 });
  return hitsFromSearch(res.items);
}
