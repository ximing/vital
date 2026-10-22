import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindEnergy(http: Http): Pick<VitalClient, 'listEnergyLogs' | 'createEnergyLog'> {
  return {
    listEnergyLogs: (query) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query?.date !== undefined) q.date = query.date;
      if (query?.from !== undefined) q.from = query.from;
      if (query?.to !== undefined) q.to = query.to;
      if (query?.since !== undefined) q.since = query.since;
      return http.request('/api/v1/energy-logs', { query: q });
    },
    createEnergyLog: (input) =>
      http.request('/api/v1/energy-logs', { method: 'POST', body: input }),
  };
}
