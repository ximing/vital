import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';
import type { CurrentReportQuery, ReportOverviewQuery } from '@vital/dto';

export function bindReports(
  http: Http,
): Pick<
  VitalClient,
  | 'listReports'
  | 'getCurrentReport'
  | 'getReportCounts'
  | 'getReportOverview'
  | 'getReport'
  | 'getReportReview'
  | 'getReportEmbeds'
  | 'patchReport'
  | 'fillReport'
  | 'generateReport'
> {
  return {
    listReports: (query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.type !== undefined) q.type = query.type;
      if (query.cursor !== undefined) q.cursor = query.cursor;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/reports', { query: q });
    },
    getCurrentReport: (type, at) => {
      const query: CurrentReportQuery = { type, ...(at ? { at } : {}) };
      return http.request('/api/v1/reports/current', { query });
    },
    getReportCounts: () => http.request('/api/v1/reports/counts'),
    getReportOverview: (type, at) => {
      const query: ReportOverviewQuery = { type, ...(at ? { at } : {}) };
      return http.request('/api/v1/reports/overview', { query });
    },
    getReport: (id, query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.asOf !== undefined) q.asOf = query.asOf;
      return http.request(`/api/v1/reports/${id}`, { query: q });
    },
    getReportReview: (id) => http.request(`/api/v1/reports/${id}/review`),
    getReportEmbeds: (id) => http.request(`/api/v1/reports/${id}/embeds`),
    patchReport: (id, input) =>
      http.request(`/api/v1/reports/${id}`, { method: 'PATCH', body: input }),
    fillReport: (id, input) =>
      http.request(`/api/v1/reports/${id}/fill`, { method: 'POST', body: input }),
    generateReport: (id) =>
      http.request(`/api/v1/reports/${id}/generate`, { method: 'POST', body: {} }),
  };
}
