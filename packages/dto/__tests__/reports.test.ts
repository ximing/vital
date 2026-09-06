import { describe, expect, it } from 'vitest';
import { extractNotes, hasWrote, replaceNotes } from '../src/reportNotes.js';
import { renderReportTemplate } from '../src/reportTemplates.js';
import {
  currentReportQuerySchema,
  fillReportInputSchema,
  patchReportInputSchema,
} from '../src/reports.js';

describe('report schemas', () => {
  it('current requires type', () => {
    expect(currentReportQuerySchema.parse({ type: 'daily' }).type).toBe('daily');
    expect(currentReportQuerySchema.parse({ type: 'daily', at: '2026-09-01' }).at).toBe(
      '2026-09-01',
    );
    expect(currentReportQuerySchema.safeParse({ type: 'daily', at: '09-01' }).success).toBe(false);
    expect(currentReportQuerySchema.safeParse({}).success).toBe(false);
  });

  it('patch requires revision and at least one field', () => {
    expect(patchReportInputSchema.parse({ revision: 1, title: 'x' }).title).toBe('x');
    expect(patchReportInputSchema.safeParse({ revision: 1 }).success).toBe(false);
    expect(patchReportInputSchema.safeParse({ title: 'x' }).success).toBe(false);
  });

  it('fill requires revision', () => {
    expect(fillReportInputSchema.parse({ revision: 3 }).revision).toBe(3);
    expect(fillReportInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('report notes segment', () => {
  it('treats a fresh template as not written', () => {
    const { bodyMd } = renderReportTemplate('daily', '2026年9月6日');
    expect(extractNotes(bodyMd, 'daily')).toBe('');
    expect(hasWrote(bodyMd, 'daily')).toBe(false);
  });

  it('round-trips notes without dropping earlier sections', () => {
    const { bodyMd } = renderReportTemplate('daily', '2026年9月6日');
    const next = replaceNotes(bodyMd, 'daily', '今天把纪要写完了。');
    expect(hasWrote(next, 'daily')).toBe(true);
    expect(extractNotes(next, 'daily')).toBe('今天把纪要写完了。');
    expect(next).toContain('## 今日完成');
    expect(next).toContain('## 进行中');
    const cleared = replaceNotes(next, 'daily', '');
    expect(hasWrote(cleared, 'daily')).toBe(false);
    expect(cleared).toContain('## 记录');
  });
});
