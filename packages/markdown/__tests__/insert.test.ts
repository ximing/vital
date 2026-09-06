import { describe, expect, it } from 'vitest';
import { ensureFillHeadings, insertTokensIdempotent } from '../src/insert.js';
import { extractTokens } from '../src/tokens.js';

const TASK_A = '11111111-1111-4111-8111-111111111111';
const TASK_B = '33333333-3333-4333-8333-333333333333';
const INBOX = '22222222-2222-4222-8222-222222222222';
const headings = { tasks: '进行中', inbox: '稍后读' };

describe('insertTokensIdempotent', () => {
  it('appends only missing tokens under headings and never emits checkboxes', () => {
    const md = `# 日报\n\n## 进行中\n\n## 稍后读\n`;
    const once = insertTokensIdempotent(
      md,
      [
        { kind: 'task', id: TASK_A, start: 0, end: 0 },
        { kind: 'inbox', id: INBOX, start: 0, end: 0 },
      ],
      headings,
    );
    expect(once).toContain(`## 进行中\n\n[[task:${TASK_A}]]\n`);
    expect(once).toContain(`## 稍后读\n\n[[inbox:${INBOX}]]\n`);
    expect(once.includes('- [ ]')).toBe(false);
    expect(once.includes('[ ]')).toBe(false);

    const twice = insertTokensIdempotent(
      once,
      [
        { kind: 'task', id: TASK_A, start: 0, end: 0 },
        { kind: 'task', id: TASK_B, start: 0, end: 0 },
        { kind: 'inbox', id: INBOX, start: 0, end: 0 },
      ],
      headings,
    );
    expect(extractTokens(twice).filter((t) => t.kind === 'task').map((t) => t.id)).toEqual([
      TASK_A,
      TASK_B,
    ]);
    expect(twice.split(`[[task:${TASK_A}]]`).length - 1).toBe(1);
  });

  it('creates a missing heading then inserts', () => {
    const md = `# 日报\n\n## 记录\n`;
    const out = insertTokensIdempotent(
      md,
      [{ kind: 'task', id: TASK_A, start: 0, end: 0 }],
      headings,
    );
    expect(out).toContain('## 进行中');
    expect(out).toContain(`[[task:${TASK_A}]]`);
  });
});

describe('ensureFillHeadings', () => {
  it('appends both parameterized headings when absent', () => {
    const weekly = { tasks: '未完成 / 结转', inbox: '稍后读' };
    const out = ensureFillHeadings('# 周报\n', weekly);
    expect(out).toContain('## 未完成 / 结转');
    expect(out).toContain('## 稍后读');
  });
});
