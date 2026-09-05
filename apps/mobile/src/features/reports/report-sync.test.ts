import { describe, expect, it, vi } from 'vitest';
import type { Report, ReportEmbeds, SyncHead } from '@vital/dto';
import { insertToken, planReportFocusSync, runReportFocusSync } from './report-sync';

const HEAD: SyncHead = {
  tasksMaxUpdatedAt: '2026-09-06T01:00:00.000Z',
  inboxMaxUpdatedAt: '2026-09-06T01:00:00.000Z',
  reportsMaxUpdatedAt: '2026-09-06T01:00:00.000Z',
  revision: 1,
};

const REPORT: Report = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'daily',
  periodStart: '2026-09-06T00:00:00.000Z',
  periodEnd: '2026-09-07T00:00:00.000Z',
  title: '日报',
  revision: 1,
  snapshotAt: null,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  bodyMd: '# 日报\n',
  embeds: { tasks: {}, inbox: {} },
};

describe('planReportFocusSync', () => {
  it('initial load fetches full report even if sync/head failed', () => {
    expect(
      planReportFocusSync({ hasReport: false, dirty: false, head: null, prevHead: null }),
    ).toEqual({ fetchFull: true, fetchEmbeds: false, toastRemote: false });
  });

  it('sync/head failure never replaces a local (dirty or clean) body', () => {
    expect(
      planReportFocusSync({ hasReport: true, dirty: true, head: null, prevHead: HEAD }),
    ).toEqual({ fetchFull: false, fetchEmbeds: false, toastRemote: false });
    expect(
      planReportFocusSync({ hasReport: true, dirty: false, head: null, prevHead: HEAD }),
    ).toEqual({ fetchFull: false, fetchEmbeds: false, toastRemote: false });
  });

  it('dirty + task/inbox watermark → embeds only, never fetchFull', () => {
    const head: SyncHead = { ...HEAD, tasksMaxUpdatedAt: '2026-09-06T02:00:00.000Z' };
    expect(
      planReportFocusSync({ hasReport: true, dirty: true, head, prevHead: HEAD }),
    ).toEqual({ fetchFull: false, fetchEmbeds: true, toastRemote: false });
  });

  it('dirty + reports watermark → toast, keep body, no full GET', () => {
    const head: SyncHead = { ...HEAD, reportsMaxUpdatedAt: '2026-09-06T02:00:00.000Z' };
    expect(
      planReportFocusSync({ hasReport: true, dirty: true, head, prevHead: HEAD }),
    ).toEqual({ fetchFull: false, fetchEmbeds: false, toastRemote: true });
  });

  it('clean + any watermark → full GET', () => {
    const head: SyncHead = { ...HEAD, reportsMaxUpdatedAt: '2026-09-06T02:00:00.000Z' };
    expect(
      planReportFocusSync({ hasReport: true, dirty: false, head, prevHead: HEAD }),
    ).toEqual({ fetchFull: true, fetchEmbeds: false, toastRemote: false });
  });
});

describe('insertToken', () => {
  it('appends and is idempotent', () => {
    const token = '[[task:11111111-1111-4111-8111-111111111111]]';
    expect(insertToken('## 进行中\n', token)).toBe(`## 进行中\n${token}\n`);
    expect(insertToken(`## 进行中\n${token}\n`, token)).toBe(`## 进行中\n${token}\n`);
  });
});

describe('runReportFocusSync', () => {
  it('dirty body survives syncHead reject — no getReport', async () => {
    const getReport = vi.fn(async (): Promise<Report> => REPORT);
    const getEmbeds = vi.fn(async (): Promise<{ revision: number; embeds: ReportEmbeds }> => ({
      revision: 1,
      embeds: { tasks: {}, inbox: {} },
    }));
    const result = await runReportFocusSync(
      {
        syncHead: async () => {
          throw new Error('network');
        },
        getReport,
        getEmbeds,
      },
      {
        reportId: REPORT.id,
        hasReport: true,
        dirty: true,
        prevHead: HEAD,
      },
    );
    expect(result.report).toBeUndefined();
    expect(result.embeds).toBeUndefined();
    expect(getReport).not.toHaveBeenCalled();
    expect(getEmbeds).not.toHaveBeenCalled();
  });

  it('dirty insert + successful sync/head still does not replace body', async () => {
    const getReport = vi.fn(async (): Promise<Report> => ({ ...REPORT, bodyMd: 'REMOTE' }));
    const result = await runReportFocusSync(
      {
        syncHead: async () => HEAD,
        getReport,
        getEmbeds: async () => ({ revision: 1, embeds: { tasks: {}, inbox: {} } }),
      },
      { reportId: REPORT.id, hasReport: true, dirty: true, prevHead: HEAD },
    );
    expect(result.report).toBeUndefined();
    expect(getReport).not.toHaveBeenCalled();
  });
});
