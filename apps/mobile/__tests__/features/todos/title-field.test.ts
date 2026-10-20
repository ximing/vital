import { describe, expect, it } from 'vitest';
import {
  TASK_TITLE_LINE_HEIGHT,
  taskTitleBoxHeight,
} from '../../../src/features/todos/title-field';

describe('taskTitleBoxHeight', () => {
  it('stays one line for a short title and caps at three', () => {
    expect(taskTitleBoxHeight(0)).toBe(TASK_TITLE_LINE_HEIGHT);
    expect(taskTitleBoxHeight(TASK_TITLE_LINE_HEIGHT)).toBe(TASK_TITLE_LINE_HEIGHT);
    expect(taskTitleBoxHeight(TASK_TITLE_LINE_HEIGHT * 2)).toBe(TASK_TITLE_LINE_HEIGHT * 2);
    expect(taskTitleBoxHeight(TASK_TITLE_LINE_HEIGHT * 8)).toBe(TASK_TITLE_LINE_HEIGHT * 3);
  });
});
