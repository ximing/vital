import { describe, expect, it } from 'vitest';
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
