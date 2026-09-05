import { describe, expect, it } from 'vitest';
import { splitForRender } from '@vital/markdown';
import { chipLabel, chipShowsBraces } from './chip-label';
import { renderPartsToLines } from './split-lines';
import type { ReportEmbeds } from '@vital/dto';

const TASK = '11111111-1111-4111-8111-111111111111';
const INBOX = '22222222-2222-4222-8222-222222222222';

const embeds: ReportEmbeds = {
  tasks: {
    [TASK]: { id: TASK, title: '写日报', status: 'todo', deletedAt: null },
  },
  inbox: {
    [INBOX]: { id: INBOX, title: '稍后读一篇', status: 'unread', deletedAt: null },
  },
};

describe('chipLabel', () => {
  it('uses embed titles and never emits token braces', () => {
    const task = chipLabel({ kind: 'task', id: TASK }, embeds);
    const inbox = chipLabel({ kind: 'inbox', id: INBOX }, embeds);
    expect(task).toBe('写日报');
    expect(inbox).toBe('稍后读一篇');
    expect(chipShowsBraces(task)).toBe(false);
    expect(chipShowsBraces(inbox)).toBe(false);
  });
});

describe('splitForRender chips', () => {
  it('keeps visible ## text and isolates entities for Pin chips', () => {
    const md = `## 进行中\n[[task:${TASK}]]\n## 稍后读\n[[inbox:${INBOX}]]\n`;
    const lines = renderPartsToLines(splitForRender(md));
    const texts = lines.flatMap((line) =>
      line.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.value : '')),
    );
    expect(texts.some((v) => v.startsWith('## '))).toBe(true);
    expect(texts.join('')).not.toContain(`[[task:${TASK}]]`);
    expect(texts.join('')).not.toContain(`[[inbox:${INBOX}]]`);
    const entities = lines.flatMap((line) => line.filter((p) => p.type === 'entity'));
    expect(entities).toHaveLength(2);
  });
});
