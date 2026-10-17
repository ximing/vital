import { WEEKLY_GOALS_HEADING } from '@vital/dto';
import type { FC } from 'react';

const H2 = /^## /;
const GOALS_H2 = `## ${WEEKLY_GOALS_HEADING}`;

/** Body of `## 按目标`, cut at the next H2. Blank when the heading is missing or empty. */
export function extractWeeklyGoals(bodyMd: string): string {
  const idx = bodyMd.indexOf(GOALS_H2);
  if (idx < 0) return '';
  const afterHeading = bodyMd.slice(idx + GOALS_H2.length);
  const afterLines = afterHeading.startsWith('\n') ? afterHeading.slice(1) : afterHeading;
  const lines = afterLines.split('\n');
  const cut = lines.findIndex((line) => H2.test(line));
  const kept = cut >= 0 ? lines.slice(0, cut) : lines;
  return kept.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/** Read-only. The report editor only binds 复盘 and must not absorb this section. */
export const WeeklyGoals: FC<{ bodyMd: string }> = ({ bodyMd }) => {
  const text = extractWeeklyGoals(bodyMd);
  if (text.trim().length === 0) return null;
  return (
    <section className="mt-10 shrink-0" data-testid="report-goals">
      <h2 className="eyebrow eyebrow-rule px-2">{WEEKLY_GOALS_HEADING}</h2>
      <p className="mt-3 max-w-[42.5rem] whitespace-pre-wrap px-2 text-[length:var(--text-body)] leading-[1.75] text-fg">
        {text}
      </p>
    </section>
  );
};
