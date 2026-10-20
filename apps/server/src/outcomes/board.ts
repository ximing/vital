/**
 * 「正在推进」is work that still needs the user.
 * A thread the user created stays, so an empty one can be filled in.
 * An agent thread stays only while it has a real open task or a linked habit.
 * Calendar events are a schedule, not a goal.
 */
export function showsOnTodayBoard(input: {
  createdBy: string;
  realOpen: number;
  linkedHabits: number;
}): boolean {
  if (input.createdBy !== 'agent') return true;
  return input.realOpen > 0 || input.linkedHabits > 0;
}
