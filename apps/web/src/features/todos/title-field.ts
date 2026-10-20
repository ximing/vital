/** Task detail titles grow with the text, then scroll inside the field. */
export const TASK_TITLE_MAX_LINES = 3;

/**
 * Size a textarea to its wrapped text, capped at `lines`.
 * Call again when the text or the field width changes.
 */
export function fitTextareaLines(node: HTMLTextAreaElement, lines: number): void {
  const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || lines < 1) return;
  const max = lineHeight * lines;
  // `auto` drops back to the rows minimum so a shorter title can shrink.
  node.style.height = 'auto';
  const content = node.scrollHeight;
  node.style.height = `${Math.max(lineHeight, Math.min(content, max))}px`;
  node.style.overflowY = content > max + 1 ? 'auto' : 'hidden';
}
