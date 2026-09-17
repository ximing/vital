import { describe, expect, it } from 'vitest';
import {
  createDayInputSchema,
  patchDayInputSchema,
  COVER_PRESETS,
} from '../src/days.js';

describe('createDayInputSchema', () => {
  it('accepts a solar custom day', () => {
    const parsed = createDayInputSchema.parse({
      name: '生日',
      calendar: 'solar',
      anchorYmd: '2020-03-01',
      repeat: 'yearly',
      reminderOffsets: [0, 7, 0],
    });
    expect(parsed.reminderOffsets).toEqual([0, 7]);
  });

  it('accepts catalog add', () => {
    expect(createDayInputSchema.parse({ catalogKey: 'cn.qixi' }).catalogKey).toBe('cn.qixi');
  });

  it('requires name and date for custom', () => {
    expect(() => createDayInputSchema.parse({ calendar: 'solar' })).toThrow();
    expect(() => createDayInputSchema.parse({ name: 'x', calendar: 'solar' })).toThrow();
    expect(() =>
      createDayInputSchema.parse({ name: 'x', calendar: 'lunar', lunarYear: 2026 }),
    ).toThrow();
  });

  it('rejects unknown cover presets', () => {
    expect(() =>
      createDayInputSchema.parse({
        name: 'x',
        anchorYmd: '2026-01-01',
        coverPreset: 'nope',
      }),
    ).toThrow();
    expect(COVER_PRESETS.includes('mist')).toBe(true);
  });
});

describe('patchDayInputSchema', () => {
  it('rejects empty patch', () => {
    expect(() => patchDayInputSchema.parse({})).toThrow();
    expect(patchDayInputSchema.parse({ hidden: true }).hidden).toBe(true);
  });
});
