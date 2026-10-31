import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindExploration(
  http: Http,
): Pick<
  VitalClient,
  | 'listExplorationWindows'
  | 'getExplorationWindow'
  | 'generateExplorationWindow'
  | 'restExplorationWindow'
  | 'selectExplorationProposal'
  | 'confirmExplorationProposal'
  | 'rejectExplorationProposal'
> {
  return {
    listExplorationWindows: () => http.request('/api/v1/exploration/windows'),
    getExplorationWindow: (id) => http.request(`/api/v1/exploration/windows/${id}`),
    generateExplorationWindow: (id, input) =>
      http.request(`/api/v1/exploration/windows/${id}/generate`, {
        method: 'POST',
        body: input ?? {},
      }),
    restExplorationWindow: (id) =>
      http.request(`/api/v1/exploration/windows/${id}/rest`, { method: 'POST', body: {} }),
    selectExplorationProposal: (id, input) =>
      http.request(`/api/v1/exploration/proposals/${id}/select`, {
        method: 'POST',
        body: input ?? {},
      }),
    confirmExplorationProposal: (id, input) =>
      http.request(`/api/v1/exploration/proposals/${id}/confirm`, {
        method: 'POST',
        body: input ?? {},
      }),
    rejectExplorationProposal: (id) =>
      http.request(`/api/v1/exploration/proposals/${id}/reject`, { method: 'POST', body: {} }),
  };
}
