import { parseReportType, type ReportType } from '@/features/reports/model';

export type AppSection =
  | 'today'
  | 'todos'
  | 'capture'
  | 'reflect'
  | 'search'
  | 'habits'
  | 'threads'
  | 'activity'
  | 'memory'
  | 'usage'
  | 'settings';

export const RHYTHM_LIST_IDS = [
  'smart:today',
  'smart:upcoming',
  'smart:someday',
  'smart:done',
] as const;

export function listIdFrom(pathname: string, search: string): string | null {
  const match = /\/todos\/lists\/([^/]+)/.exec(pathname);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return new URLSearchParams(search).get('list');
}

export function sectionOf(pathname: string, _search: string): AppSection {
  if (pathname.startsWith('/today')) return 'today';
  if (pathname.startsWith('/inbox')) return 'capture';
  if (pathname.startsWith('/reports')) return 'reflect';
  if (pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/habits')) return 'habits';
  if (pathname.startsWith('/threads')) return 'threads';
  if (pathname.startsWith('/activity')) return 'activity';
  if (pathname.startsWith('/memory')) return 'memory';
  if (pathname.startsWith('/usage')) return 'usage';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/todos')) return 'todos';
  return 'today';
}

export function showsPane(section: AppSection): boolean {
  return section === 'todos' || section === 'capture' || section === 'reflect';
}

export function reportTypeOf(search: string): ReportType {
  return parseReportType(new URLSearchParams(search).get('type'));
}

export function rhythmHref(listId: string, pathname: string): string {
  const encoded = encodeURIComponent(listId);
  if (pathname.startsWith('/todos/board')) return `/todos/board?list=${encoded}`;
  if (pathname.startsWith('/todos/calendar')) return `/todos/calendar?list=${encoded}`;
  return `/todos/lists/${listId}`;
}
