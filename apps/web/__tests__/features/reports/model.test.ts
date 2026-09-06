import type { SyncHead } from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { describe, expect, it } from 'vitest';
import {
  applyRemoteBody,
  decidePoll,
  insertEntityToken,
  isDirty,
  isRevisionConflict,
  mergeEmbeds,
  parseReportType,
  slashFromText,
  withStubEmbed,
} from '../../../src/features/reports/model';

const head = (over: Partial<SyncHead> = {}): SyncHead => ({
  tasksMaxUpdatedAt: 't1',
  inboxMaxUpdatedAt: 'i1',
  reportsMaxUpdatedAt: 'r1',
  revision: 1,
  ...over,
});

describe('report poll', () => {
  it('does nothing on the first head (no prev)', () => {
    expect(decidePoll(null, head(), false)).toEqual({
      fetchEmbeds: false,
      toastRemote: false,
      reloadBody: false,
    });
    expect(decidePoll(null, head(), true)).toEqual({
      fetchEmbeds: false,
      toastRemote: false,
      reloadBody: false,
    });
  });

  it('reloads body when reports watermark moved and the editor is clean', () => {
    expect(decidePoll(head(), head({ reportsMaxUpdatedAt: 'r2' }), false)).toEqual({
      fetchEmbeds: false,
      toastRemote: false,
      reloadBody: true,
    });
  });

  it('toasts and never reloads body when reports watermark moved while dirty', () => {
    expect(decidePoll(head(), head({ reportsMaxUpdatedAt: 'r2' }), true)).toEqual({
      fetchEmbeds: false,
      toastRemote: true,
      reloadBody: false,
    });
  });

  it('fetches embeds only when task or inbox watermarks move', () => {
    expect(decidePoll(head(), head({ tasksMaxUpdatedAt: 't2' }), false)).toEqual({
      fetchEmbeds: true,
      toastRemote: false,
      reloadBody: false,
    });
    expect(decidePoll(head(), head({ inboxMaxUpdatedAt: 'i2' }), true)).toEqual({
      fetchEmbeds: true,
      toastRemote: false,
      reloadBody: false,
    });
  });

  it('prefers embeds+toast over body reload when dirty and several watermarks move', () => {
    expect(
      decidePoll(head(), head({ tasksMaxUpdatedAt: 't2', reportsMaxUpdatedAt: 'r2' }), true),
    ).toEqual({ fetchEmbeds: true, toastRemote: true, reloadBody: false });
  });

  it('never replaces a dirty bodyMd', () => {
    expect(applyRemoteBody(true, 'local', 'remote')).toBe('local');
    expect(applyRemoteBody(false, 'local', 'remote')).toBe('remote');
  });
});

describe('slash and tokens', () => {
  it('activates on a leading / and after whitespace, not inside https://', () => {
    expect(slashFromText('/task', 5)).toEqual({ query: 'task', from: 0, to: 5 });
    expect(slashFromText('pin /in', 7)).toEqual({ query: 'in', from: 4, to: 7 });
    expect(slashFromText('https://x', 9)).toBeNull();
    expect(slashFromText('a/b', 3)).toBeNull();
  });

  it('inserts exact [[kind:id]] tokens', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(insertEntityToken('/t', 0, 2, 'task', id)).toBe(`[[task:${id}]]`);
    expect(insertEntityToken('x /y', 2, 4, 'inbox', id)).toBe(`x [[inbox:${id}]]`);
  });
});

describe('revision and embeds', () => {
  it('detects REPORT_REVISION_CONFLICT', () => {
    expect(
      isRevisionConflict(new ApiError(409, 'REPORT_REVISION_CONFLICT', '报告已被更新，请先同步')),
    ).toBe(true);
    expect(isRevisionConflict(new ApiError(400, 'VALIDATION_ERROR', 'x'))).toBe(false);
  });

  it('merges remote embeds over local stubs', () => {
    const local = withStubEmbed({ tasks: {}, inbox: {} }, 'task', 't1', '本地');
    const merged = mergeEmbeds(local, {
      tasks: { t1: { id: 't1', title: '远端', status: 'done', deletedAt: null } },
      inbox: {},
    });
    expect(merged.tasks.t1?.title).toBe('远端');
    expect(merged.tasks.t1?.status).toBe('done');
  });

  it('treats trailing newlines as not dirty', () => {
    expect(isDirty('# a\n', '# a\n\n')).toBe(false);
    expect(isDirty('# a\n', '# b\n')).toBe(true);
  });

  it('parses type query', () => {
    expect(parseReportType('weekly')).toBe('weekly');
    expect(parseReportType('nope')).toBe('daily');
    expect(parseReportType(null)).toBe('daily');
  });
});
