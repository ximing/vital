import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindToday(http: Http): Pick<VitalClient, 'getToday' | 'putTodayLayoutContext'> {
  return {
    getToday: () => http.request('/api/v1/today'),
    putTodayLayoutContext: (input) =>
      http.request('/api/v1/today/layout-context', { method: 'PUT', body: input }),
  };
}
