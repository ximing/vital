import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindOutcomes(
  http: Http,
): Pick<
  VitalClient,
  | 'listOutcomes'
  | 'getOutcomeDetail'
  | 'createOutcome'
  | 'patchOutcome'
  | 'closeOutcome'
  | 'reopenOutcome'
  | 'undoOutcome'
  | 'refreshOutcome'
> {
  return {
    listOutcomes: (status) => http.request(`/api/v1/outcomes${status ? `?status=${status}` : ''}`),
    getOutcomeDetail: (id) => http.request(`/api/v1/outcomes/${id}/detail`),
    createOutcome: (input) => http.request('/api/v1/outcomes', { method: 'POST', body: input }),
    patchOutcome: (id, input) =>
      http.request(`/api/v1/outcomes/${id}`, { method: 'PATCH', body: input }),
    closeOutcome: (id) => http.request(`/api/v1/outcomes/${id}/close`, { method: 'POST' }),
    reopenOutcome: (id) => http.request(`/api/v1/outcomes/${id}/reopen`, { method: 'POST' }),
    undoOutcome: async (id) => {
      await http.request(`/api/v1/outcomes/${id}/undo`, { method: 'POST' });
    },
    refreshOutcome: async (id) => {
      await http.request(`/api/v1/outcomes/${id}/refresh`, { method: 'POST' });
    },
  };
}
