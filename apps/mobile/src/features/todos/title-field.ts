/** Matches the task-sheet title `lineHeight`. */
export const TASK_TITLE_LINE_HEIGHT = 30;
export const TASK_TITLE_MAX_LINES = 3;

/**
 * Android's default `numberOfLines` is 1, and that calls `setLines(1)`, so the
 * field stays one line tall and scrolls inside it. A taller layout cap lets the
 * rest of the title exist; the box height is what stops the field at three lines.
 */
export const TASK_TITLE_LAYOUT_LINES = 40;

/** Visible title height: follow the text, then stop at three lines. */
export function taskTitleBoxHeight(contentHeight: number): number {
  const line = TASK_TITLE_LINE_HEIGHT;
  const max = line * TASK_TITLE_MAX_LINES;
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return line;
  return Math.min(max, Math.max(line, Math.ceil(contentHeight)));
}
