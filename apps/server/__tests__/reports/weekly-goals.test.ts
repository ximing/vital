import { describe, expect, it } from 'vitest';
import { replaceWeeklyGoals, renderWeeklyGoals, type WeeklyGoalEntry } from '../../src/reports/weekly-goals.js';

const ADVANCED: WeeklyGoalEntry = {
  name: '写作',
  done: 1,
  total: 3,
  advanced: ['交大纲'],
  stalled: ['改二稿', '找资料'],
  nextStep: '改二稿',
};

function sectionOf(entry: WeeklyGoalEntry): string {
  const text = renderWeeklyGoals([entry]);
  if (text === null) throw new Error('expected a section');
  return text;
}

describe('renderWeeklyGoals', () => {
  it('snapshots progress, this week, stalled titles, and the next step', () => {
    expect(sectionOf(ADVANCED)).toBe(
      [
        '## 按目标',
        '',
        '写作',
        '进展 1/3 里程碑。',
        '本周推进：交大纲。',
        '停滞：改二稿、找资料。',
        '下周一步：改二稿。',
        '',
      ].join('\n'),
    );
  });

  it('does not invent a stalled line when nothing stalled', () => {
    const text = sectionOf({
      ...ADVANCED,
      advanced: [],
      stalled: [],
      nextStep: null,
    });
    expect(text).toBe(
      ['## 按目标', '', '写作', '进展 1/3 里程碑。', '本周没有推进里程碑。', ''].join('\n'),
    );
    expect(text).not.toContain('停滞');
    expect(text).not.toContain('下周一步');
  });

  it('omits outcomes that have no milestones', () => {
    expect(
      renderWeeklyGoals([
        { name: '空目标', done: 0, total: 0, advanced: [], stalled: ['不该出现'], nextStep: '不该出现' },
      ]),
    ).toBeNull();
    expect(
      renderWeeklyGoals([
        { name: '空目标', done: 0, total: 0, advanced: [], stalled: [], nextStep: null },
        ADVANCED,
      ]),
    ).toBe(sectionOf(ADVANCED));
  });
});

describe('replaceWeeklyGoals', () => {
  const body = [
    '# 周报',
    '',
    '## 本周完成',
    '',
    '## 未完成 / 结转',
    '',
    '## 稍后读',
    '',
    '## 洞察',
    '',
    '这周晚上 11 点后建了 6 个任务。',
    '',
    '## 复盘',
    '',
    '用户笔记。',
    '',
  ].join('\n');

  it('inserts 按目标 between 洞察 and 复盘 and is idempotent', () => {
    const section = sectionOf(ADVANCED);
    const once = replaceWeeklyGoals(body, section);
    expect(once.indexOf('## 洞察')).toBeLessThan(once.indexOf('## 按目标'));
    expect(once.indexOf('## 按目标')).toBeLessThan(once.indexOf('## 复盘'));
    expect(once).toContain('这周晚上 11 点后建了 6 个任务。');
    expect(once).toContain('用户笔记。');
    expect(once).toContain('进展 1/3 里程碑。');
    expect(replaceWeeklyGoals(once, section)).toBe(once);
  });

  it('removes the heading without taking 洞察 or 复盘 with it', () => {
    const once = replaceWeeklyGoals(body, sectionOf(ADVANCED));
    const cleared = replaceWeeklyGoals(once, null);
    expect(cleared).not.toContain('## 按目标');
    expect(cleared).not.toContain('停滞');
    expect(cleared).toContain('## 洞察');
    expect(cleared).toContain('这周晚上 11 点后建了 6 个任务。');
    expect(cleared).toContain('## 复盘');
    expect(cleared).toContain('用户笔记。');
    expect(replaceWeeklyGoals(cleared, null)).toBe(cleared);
  });
});
