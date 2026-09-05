import type { Report, ReportEmbeds, SyncHead } from '@vital/dto';

export type ReportFocusPlan = {
  /** Replace bodyMd from GET /reports/:id. Never true when dirty. */
  fetchFull: boolean;
  /** GET /reports/:id/embeds only — never touches bodyMd. */
  fetchEmbeds: boolean;
  toastRemote: boolean;
};

/**
 * Focus refetch: never replace dirty bodyMd.
 * Dirty → embeds if task/inbox watermarks moved; toast if reports moved.
 * Clean → full GET only when a watermark moved.
 * sync/head failure with a local report → hold (no GET).
 */
export function planReportFocusSync(input: {
  hasReport: boolean;
  dirty: boolean;
  head: SyncHead | null;
  prevHead: SyncHead | null;
}): ReportFocusPlan {
  if (!input.hasReport) {
    return { fetchFull: true, fetchEmbeds: false, toastRemote: false };
  }
  if (input.head === null) {
    return { fetchFull: false, fetchEmbeds: false, toastRemote: false };
  }
  const prev = input.prevHead;
  const taskMoved = prev !== null && input.head.tasksMaxUpdatedAt !== prev.tasksMaxUpdatedAt;
  const inboxMoved = prev !== null && input.head.inboxMaxUpdatedAt !== prev.inboxMaxUpdatedAt;
  const reportsMoved = prev !== null && input.head.reportsMaxUpdatedAt !== prev.reportsMaxUpdatedAt;
  if (input.dirty) {
    return {
      fetchFull: false,
      fetchEmbeds: taskMoved || inboxMoved,
      toastRemote: reportsMoved,
    };
  }
  return {
    fetchFull: taskMoved || inboxMoved || reportsMoved,
    fetchEmbeds: false,
    toastRemote: false,
  };
}

export function insertToken(md: string, token: string): string {
  if (md.includes(token)) return md;
  const sep = md === '' || md.endsWith('\n') ? '' : '\n';
  return `${md}${sep}${token}\n`;
}

export type ReportFocusResult = {
  head: SyncHead | null;
  report: Report | undefined;
  embeds: ReportEmbeds | undefined;
  toastRemote: boolean;
};

export async function runReportFocusSync(
  deps: {
    syncHead: () => Promise<SyncHead>;
    getReport: (id: string) => Promise<Report>;
    getEmbeds: (id: string) => Promise<{ revision: number; embeds: ReportEmbeds }>;
  },
  state: {
    reportId: string;
    hasReport: boolean;
    dirty: boolean;
    prevHead: SyncHead | null;
  },
): Promise<ReportFocusResult> {
  const head = await deps.syncHead().catch(() => null);
  const plan = planReportFocusSync({
    hasReport: state.hasReport,
    dirty: state.dirty,
    head,
    prevHead: state.prevHead,
  });
  const result: ReportFocusResult = {
    head,
    report: undefined,
    embeds: undefined,
    toastRemote: plan.toastRemote,
  };
  if (plan.fetchFull) {
    result.report = await deps.getReport(state.reportId);
    return result;
  }
  if (plan.fetchEmbeds) {
    result.embeds = (await deps.getEmbeds(state.reportId)).embeds;
  }
  return result;
}
