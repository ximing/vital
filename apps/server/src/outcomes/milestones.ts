/** Done and total ignore canceled tasks. Non-milestones do not count. */
export function milestoneProgress(
  tasks: readonly { isMilestone: boolean; status: string }[],
): { done: number; total: number } {
  const rows = tasks.filter((task) => task.isMilestone && task.status !== 'canceled');
  return { done: rows.filter((task) => task.status === 'done').length, total: rows.length };
}

/**
 * Headline must show the real fraction when milestones exist.
 * A fraction with no milestones is dropped so the model cannot invent one.
 */
export function withMilestoneHeadline(headline: string, done: number, total: number): string {
  const cleaned = headline.replace(/\s+/g, ' ').trim();
  const stripped = cleaned.replace(/\d+\/\d+ 里程碑/g, '').replace(/\s+/g, ' ').trim();
  if (total <= 0) return stripped;
  const mark = `${String(done)}/${String(total)} 里程碑`;
  if (stripped === '') return mark;
  if (stripped.includes(mark)) return stripped.slice(0, 500);
  return `${stripped} ${mark}`.slice(0, 500);
}
