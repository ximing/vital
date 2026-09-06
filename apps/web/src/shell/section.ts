import { parseReportType, type ReportType } from '@/features/reports/model';

export type AppSection = 'rhythm' | 'capture' | 'lists' | 'reflect' | 'search' | 'settings';

export const RHYTHM_LIST_IDS = [
  'smart:today',
  'smart:upcoming',
  'smart:anytime',
  'smart:someday',
  'smart:done',
] as const;

export function listIdFrom(pathname: string, search: string): string | null {
  const match = /\/todos\/lists\/([^/]+)/.exec(pathname);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return new URLSearchParams(search).get('list');
}

export function sectionOf(pathname: string, search: string): AppSection {
  if (pathname.startsWith('/inbox')) return 'capture';
  if (pathname.startsWith('/reports')) return 'reflect';
  if (pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/todos')) {
    const id = listIdFrom(pathname, search);
    if (id && (RHYTHM_LIST_IDS as readonly string[]).includes(id)) return 'rhythm';
    return 'lists';
  }
  return 'rhythm';
}

export function showsPane(section: AppSection): boolean {
  return section === 'rhythm' || section === 'capture' || section === 'lists' || section === 'reflect';
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
