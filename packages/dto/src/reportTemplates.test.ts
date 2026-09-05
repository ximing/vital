import { describe, expect, it } from 'vitest';
import { fillHeadingsFor, renderReportTemplate, REPORT_TEMPLATES } from './reportTemplates.js';

describe('Chinese default templates', () => {
  it('daily uses 进行中 / 稍后读', () => {
    expect(fillHeadingsFor('daily')).toEqual({ tasks: '进行中', inbox: '稍后读' });
    const { title, bodyMd } = renderReportTemplate('daily', '2026年9月6日');
    expect(title).toBe('2026年9月6日 日报');
    expect(bodyMd).toContain('# 2026年9月6日 日报');
    expect(bodyMd).toContain('## 今日完成');
    expect(bodyMd).toContain('## 进行中');
    expect(bodyMd).toContain('## 稍后读');
    expect(bodyMd).toContain('## 记录');
  });

  it('weekly/monthly/yearly use 未完成 / 结转', () => {
    expect(fillHeadingsFor('weekly').tasks).toBe('未完成 / 结转');
    expect(REPORT_TEMPLATES.weekly.doneHeading).toBe('本周完成');
    expect(REPORT_TEMPLATES.monthly.doneHeading).toBe('本月完成');
    expect(REPORT_TEMPLATES.yearly.doneHeading).toBe('本年完成');
    expect(renderReportTemplate('weekly', '9月1日 – 9月7日').title).toBe('9月1日 – 9月7日 周报');
  });
});
