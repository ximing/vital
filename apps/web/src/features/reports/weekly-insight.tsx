import { WEEKLY_INSIGHT_HEADING } from '@vital/dto';
import type { FC } from 'react';

const H2 = /^## /;
const INSIGHT_H2 = `## ${WEEKLY_INSIGHT_HEADING}`;

/**
 * Body of `## 洞察`, cut at the next H2. Blank when the heading is missing
 * or the section has no sentence — callers must not invent one.
 * Same slice as the weekly-observe writer (`replaceInsightSection`).
 */
export function extractWeeklyInsight(bodyMd: string): string {
  const idx = bodyMd.indexOf(INSIGHT_H2);
  if (idx < 0) return '';
  const afterHeading = bodyMd.slice(idx + INSIGHT_H2.length);
  const afterLines = afterHeading.startsWith('\n') ? afterHeading.slice(1) : afterHeading;
  const lines = afterLines.split('\n');
  const cut = lines.findIndex((line) => H2.test(line));
  const kept = cut >= 0 ? lines.slice(0, cut) : lines;
  return kept.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/** Read-only. The report editor only binds 复盘 and must not absorb this section. */
export const WeeklyInsight: FC<{ bodyMd: string }> = ({ bodyMd }) => {
  const text = extractWeeklyInsight(bodyMd);
  if (text.trim().length === 0) return null;
  return (
    <section className="mt-10 shrink-0" data-testid="report-insight">
      <h2 className="eyebrow eyebrow-rule px-2">{WEEKLY_INSIGHT_HEADING}</h2>
      <p className="mt-3 max-w-[42.5rem] whitespace-pre-wrap px-2 text-[length:var(--text-body)] leading-[1.75] text-fg">
        {text}
      </p>
    </section>
  );
};
