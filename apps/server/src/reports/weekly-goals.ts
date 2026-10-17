import { REPORT_TEMPLATES, WEEKLY_GOALS_HEADING } from '@vital/dto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { outcomes, reports, tasks, type ReportRow } from '../db/schema.js';
import { getUserEntity } from '../auth/auth.service.js';
import { periodInstants } from './period.js';

const GOALS_H2 = `## ${WEEKLY_GOALS_HEADING}`;
const NOTES_H2 = `## ${REPORT_TEMPLATES.weekly.notesHeading}`;
const H2 = /^## /;

export interface WeeklyGoalEntry {
  name: string;
  done: number;
  total: number;
  /** Milestone titles completed inside the report week. */
  advanced: string[];
  /** Open milestones not touched this week. Empty means do not mention 停滞. */
  stalled: string[];
  nextStep: string | null;
}

/**
 * One block per open outcome that has milestones.
 * Outcomes with none are omitted. No stalled line when nothing stalled.
 */
export function renderWeeklyGoals(entries: readonly WeeklyGoalEntry[]): string | null {
  const rows = entries.filter((entry) => entry.total > 0);
  if (rows.length === 0) return null;
  const lines = [GOALS_H2, ''];
  for (const entry of rows) {
    lines.push(entry.name);
    lines.push(`进展 ${String(entry.done)}/${String(entry.total)} 里程碑。`);
    lines.push(
      entry.advanced.length > 0 ? `本周推进：${entry.advanced.join('、')}。` : '本周没有推进里程碑。',
    );
    if (entry.stalled.length > 0) lines.push(`停滞：${entry.stalled.join('、')}。`);
    if (entry.nextStep) lines.push(`下周一步：${entry.nextStep}。`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

/** Insert, replace, or remove `## 按目标`. Other H2 sections stay. */
export function replaceWeeklyGoals(bodyMd: string, section: string | null): string {
  const trimmed = section?.replace(/\n+$/, '').trim() ?? '';
  const idx = bodyMd.indexOf(GOALS_H2);
  if (trimmed === '') {
    if (idx < 0) return bodyMd;
    const afterHeading = bodyMd.slice(idx + GOALS_H2.length);
    const afterLines = afterHeading.startsWith('\n') ? afterHeading.slice(1) : afterHeading;
    const lines = afterLines.split('\n');
    const cut = lines.findIndex((line) => H2.test(line));
    const tail = cut >= 0 ? lines.slice(cut).join('\n') : '';
    const before = bodyMd.slice(0, idx).replace(/\n+$/, '');
    if (tail === '') return before === '' ? '' : `${before}\n`;
    if (before === '') return tail.endsWith('\n') ? tail : `${tail}\n`;
    return `${before}\n\n${tail.endsWith('\n') ? tail : `${tail}\n`}`;
  }
  const block = `${trimmed}\n`;
  if (idx >= 0) {
    const afterHeading = bodyMd.slice(idx + GOALS_H2.length);
    const afterLines = afterHeading.startsWith('\n') ? afterHeading.slice(1) : afterHeading;
    const lines = afterLines.split('\n');
    const cut = lines.findIndex((line) => H2.test(line));
    const tail = cut >= 0 ? `\n${lines.slice(cut).join('\n')}` : '';
    return `${bodyMd.slice(0, idx)}${block}${tail.replace(/^\n\n/, '\n')}`;
  }
  const notesIdx = bodyMd.indexOf(NOTES_H2);
  if (notesIdx >= 0) {
    const before = bodyMd.slice(0, notesIdx).replace(/\n+$/, '');
    return `${before}\n\n${block}\n${bodyMd.slice(notesIdx)}`;
  }
  return `${bodyMd.replace(/\n+$/, '')}\n\n${block}`;
}

export async function loadWeeklyGoalEntries(
  userId: string,
  periodStart: string,
  periodEnd: string,
  timezone: string,
): Promise<WeeklyGoalEntry[]> {
  const bounds = periodInstants(periodStart, periodEnd, timezone);
  const rows = await getDb()
    .select({
      outcomeName: outcomes.name,
      nextStep: outcomes.ruleNextStep,
      title: tasks.title,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .innerJoin(outcomes, and(eq(outcomes.id, tasks.outcomeId), eq(outcomes.userId, userId)))
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.isMilestone, true),
        isNull(tasks.deletedAt),
        isNull(tasks.habitId),
        eq(outcomes.status, 'open'),
      ),
    );
  const byName = new Map<string, WeeklyGoalEntry>();
  for (const row of rows) {
    if (row.status === 'canceled') continue;
    const entry = byName.get(row.outcomeName) ?? {
      name: row.outcomeName,
      done: 0,
      total: 0,
      advanced: [],
      stalled: [],
      nextStep: row.nextStep,
    };
    entry.total += 1;
    if (row.status === 'done') {
      entry.done += 1;
      if (row.completedAt && row.completedAt >= bounds.start && row.completedAt < bounds.end) {
        entry.advanced.push(row.title);
      }
    } else if (
      (row.status === 'todo' || row.status === 'doing') &&
      row.updatedAt < bounds.start
    ) {
      entry.stalled.push(row.title);
    }
    byName.set(row.outcomeName, entry);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/** Current weekly report only. A frozen week keeps the section it already has. */
export async function syncWeeklyGoals(row: ReportRow): Promise<ReportRow> {
  if (row.type !== 'weekly' || row.snapshotAt !== null) return row;
  const user = await getUserEntity(row.userId);
  const section = renderWeeklyGoals(
    await loadWeeklyGoalEntries(row.userId, row.periodStart, row.periodEnd, user.timezone),
  );
  const next = replaceWeeklyGoals(row.bodyMd, section);
  if (next === row.bodyMd) return row;
  const [updated] = await getDb()
    .update(reports)
    .set({ bodyMd: next, revision: row.revision + 1, updatedAt: new Date() })
    .where(and(eq(reports.id, row.id), eq(reports.userId, row.userId), eq(reports.revision, row.revision)))
    .returning();
  return updated ?? row;
}
