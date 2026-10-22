import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindDays(
  http: Http,
): Pick<
  VitalClient,
  | 'listDays'
  | 'listDayCatalog'
  | 'getDayCalendarMeta'
  | 'getDay'
  | 'createDay'
  | 'patchDay'
  | 'deleteDay'
> {
  return {
    listDays: () => http.request('/api/v1/days'),
    listDayCatalog: () => http.request('/api/v1/days/catalog'),
    getDayCalendarMeta: (year) => http.request('/api/v1/days/meta', { query: { year } }),
    getDay: (id) => http.request(`/api/v1/days/${id}`),
    createDay: (input) => http.request('/api/v1/days', { method: 'POST', body: input }),
    patchDay: (id, input) => http.request(`/api/v1/days/${id}`, { method: 'PATCH', body: input }),
    deleteDay: async (id) => {
      await http.request(`/api/v1/days/${id}`, { method: 'DELETE' });
    },
  };
}
