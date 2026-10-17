import { z } from 'zod';

export const reportTypeSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
export type ReportType = z.infer<typeof reportTypeSchema>;

export interface ReportFillHeadings {
  tasks: string;
  inbox: string;
}

export interface ReportTemplate {
  type: ReportType;
  titleSuffix: string;
  doneHeading: string;
  tasksHeading: string;
  inboxHeading: string;
  notesHeading: string;
}

export const REPORT_TEMPLATES: Record<ReportType, ReportTemplate> = {
  daily: {
    type: 'daily',
    titleSuffix: '日报',
    doneHeading: '今日完成',
    tasksHeading: '进行中',
    inboxHeading: '稍后读',
    notesHeading: '记录',
  },
  weekly: {
    type: 'weekly',
    titleSuffix: '周报',
    doneHeading: '本周完成',
    tasksHeading: '未完成 / 结转',
    inboxHeading: '稍后读',
    notesHeading: '复盘',
  },
  monthly: {
    type: 'monthly',
    titleSuffix: '月报',
    doneHeading: '本月完成',
    tasksHeading: '未完成 / 结转',
    inboxHeading: '稍后读',
    notesHeading: '复盘',
  },
  yearly: {
    type: 'yearly',
    titleSuffix: '年报',
    doneHeading: '本年完成',
    tasksHeading: '未完成 / 结转',
    inboxHeading: '稍后读',
    notesHeading: '复盘',
  },
};

/** Weekly reports only. The agent writes patterns here; 复盘 stays the user's notes. */
export const WEEKLY_INSIGHT_HEADING = '洞察';

/** Weekly reports only. Milestone progress for open outcomes. 复盘 stays the user's notes. */
export const WEEKLY_GOALS_HEADING = '按目标';

export function fillHeadingsFor(type: ReportType): ReportFillHeadings {
  const t = REPORT_TEMPLATES[type];
  return { tasks: t.tasksHeading, inbox: t.inboxHeading };
}

export function renderReportTemplate(
  type: ReportType,
  label: string,
): { title: string; bodyMd: string } {
  const t = REPORT_TEMPLATES[type];
  const title = `${label} ${t.titleSuffix}`;
  const lines = [
    `# ${title}`,
    '',
    `## ${t.doneHeading}`,
    '',
    `## ${t.tasksHeading}`,
    '',
    `## ${t.inboxHeading}`,
    '',
  ];
  if (type === 'weekly') lines.push(`## ${WEEKLY_INSIGHT_HEADING}`, '');
  lines.push(`## ${t.notesHeading}`, '');
  return { title, bodyMd: lines.join('\n') };
}
