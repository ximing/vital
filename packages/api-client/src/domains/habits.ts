import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindHabits(
  http: Http,
): Pick<
  VitalClient,
  'listHabits' | 'listHabitCheckins' | 'createHabit' | 'patchHabit' | 'tickHabit' | 'deleteHabit'
> {
  return {
    listHabits: () => http.request('/api/v1/habits'),
    listHabitCheckins: (query) =>
      http.request('/api/v1/habits/checkins', { query: { from: query.from, to: query.to } }),
    createHabit: (input) => http.request('/api/v1/habits', { method: 'POST', body: input }),
    patchHabit: (id, input) =>
      http.request(`/api/v1/habits/${id}`, { method: 'PATCH', body: input }),
    tickHabit: (id) => http.request(`/api/v1/habits/${id}/tick`, { method: 'POST' }),
    deleteHabit: async (id) => {
      await http.request(`/api/v1/habits/${id}`, { method: 'DELETE' });
    },
  };
}
