import { describe, expect, it } from 'vitest';
import {
  extractTokens,
  parseEntityToken,
  renderToken,
  splitForRender,
} from '../src/tokens.js';

const TASK = '11111111-1111-4111-8111-111111111111';
const INBOX = '22222222-2222-4222-8222-222222222222';

describe('renderToken', () => {
  it('serializes exactly [[kind:uuid]] with no checkbox', () => {
    expect(renderToken('task', TASK)).toBe(`[[task:${TASK}]]`);
    expect(renderToken('inbox', INBOX)).toBe(`[[inbox:${INBOX}]]`);
    expect(renderToken('task', TASK).includes('[ ]')).toBe(false);
  });
});

describe('extractTokens', () => {
  it('finds task and inbox tokens; UUID v1–8 only', () => {
    const md = `x [[task:${TASK}]] y [[inbox:${INBOX}]] z`;
    expect(extractTokens(md)).toEqual([
      { kind: 'task', id: TASK, start: 2, end: 2 + `[[task:${TASK}]]`.length },
      {
        kind: 'inbox',
        id: INBOX,
        start: md.indexOf(`[[inbox:${INBOX}]]`),
        end: md.indexOf(`[[inbox:${INBOX}]]`) + `[[inbox:${INBOX}]]`.length,
      },
    ]);
    expect(extractTokens(`[[task:00000000-0000-0000-0000-000000000000]]`)).toEqual([]);
    expect(extractTokens(`[[note:${TASK}]]`)).toEqual([]);
  });

  it('is case-insensitive on kind and hex', () => {
    const md = `[[TASK:${TASK.toUpperCase()}]]`;
    expect(extractTokens(md)).toEqual([
      { kind: 'task', id: TASK, start: 0, end: md.length },
    ]);
  });
});

describe('splitForRender', () => {
  it('splits text and entity segments for RN overlay', () => {
    const md = `hi [[task:${TASK}]]!`;
    expect(splitForRender(md)).toEqual([
      { type: 'text', value: 'hi ' },
      {
        type: 'entity',
        token: { kind: 'task', id: TASK, start: 3, end: 3 + `[[task:${TASK}]]`.length },
      },
      { type: 'text', value: '!' },
    ]);
    expect(splitForRender('plain')).toEqual([{ type: 'text', value: 'plain' }]);
    expect(splitForRender('')).toEqual([]);
  });
});

describe('parseEntityToken', () => {
  it('rejects malformed wrappers', () => {
    expect(parseEntityToken(`[[task:${TASK}]]`)).toEqual({
      kind: 'task',
      id: TASK,
      start: 0,
      end: `[[task:${TASK}]]`.length,
    });
    expect(parseEntityToken(`[[task:${TASK}]`)).toBeNull();
  });
});
