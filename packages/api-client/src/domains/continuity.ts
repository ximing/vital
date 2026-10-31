import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindContinuity(
  http: Http,
): Pick<
  VitalClient,
  | 'getOutcomeContinuity'
  | 'putOutcomeContinuity'
  | 'activateOutcomeContinuity'
  | 'pauseOutcomeContinuity'
  | 'resumeOutcomeContinuity'
  | 'endOutcomeContinuity'
  | 'getContinuitySettings'
  | 'putContinuitySettings'
  | 'listContinuityInterventions'
  | 'markContinuityInterventionSeen'
  | 'snoozeContinuityIntervention'
  | 'feedbackContinuityIntervention'
  | 'createContinuityEvidence'
  | 'patchContinuityEvidence'
  | 'deleteContinuityEvidence'
  | 'createContinuityExperiment'
  | 'getContinuityExperiment'
  | 'completeContinuityExperiment'
  | 'listOutcomeContinuityDependencies'
  | 'createOutcomeContinuityDependency'
  | 'patchContinuityDependency'
  | 'deleteContinuityDependency'
  | 'listContinuityProtectedBlocks'
  | 'createContinuityProtectedBlock'
  | 'patchContinuityProtectedBlock'
  | 'deleteContinuityProtectedBlock'
> {
  return {
    getOutcomeContinuity: (id) => http.request(`/api/v1/outcomes/${id}/continuity`),
    putOutcomeContinuity: (id, input) =>
      http.request(`/api/v1/outcomes/${id}/continuity`, { method: 'PUT', body: input }),
    activateOutcomeContinuity: (id, input) =>
      http.request(`/api/v1/outcomes/${id}/continuity/activate`, {
        method: 'POST',
        body: input ?? {},
      }),
    pauseOutcomeContinuity: (id, input) =>
      http.request(`/api/v1/outcomes/${id}/continuity/pause`, { method: 'POST', body: input ?? {} }),
    resumeOutcomeContinuity: (id, input) =>
      http.request(`/api/v1/outcomes/${id}/continuity/resume`, { method: 'POST', body: input ?? {} }),
    endOutcomeContinuity: (id, input) =>
      http.request(`/api/v1/outcomes/${id}/continuity/end`, { method: 'POST', body: input ?? {} }),
    getContinuitySettings: () => http.request('/api/v1/continuity/settings'),
    putContinuitySettings: (input) =>
      http.request('/api/v1/continuity/settings', { method: 'PUT', body: input }),
    listContinuityInterventions: () => http.request('/api/v1/continuity/interventions'),
    markContinuityInterventionSeen: (id) =>
      http.request(`/api/v1/continuity/interventions/${id}/seen`, { method: 'POST', body: {} }),
    snoozeContinuityIntervention: (id, input) =>
      http.request(`/api/v1/continuity/interventions/${id}/snooze`, {
        method: 'POST',
        body: input ?? {},
      }),
    feedbackContinuityIntervention: (id, input) =>
      http.request(`/api/v1/continuity/interventions/${id}/feedback`, {
        method: 'POST',
        body: input,
      }),
    createContinuityEvidence: (input) =>
      http.request('/api/v1/continuity/evidence', { method: 'POST', body: input }),
    patchContinuityEvidence: (id, input) =>
      http.request(`/api/v1/continuity/evidence/${id}`, { method: 'PATCH', body: input }),
    deleteContinuityEvidence: (id) =>
      http.request(`/api/v1/continuity/evidence/${id}`, { method: 'DELETE' }),
    createContinuityExperiment: (input) =>
      http.request('/api/v1/continuity/experiments', { method: 'POST', body: input }),
    getContinuityExperiment: (id) => http.request(`/api/v1/continuity/experiments/${id}`),
    completeContinuityExperiment: (id) =>
      http.request(`/api/v1/continuity/experiments/${id}/complete`, { method: 'POST', body: {} }),
    listOutcomeContinuityDependencies: (id) =>
      http.request(`/api/v1/outcomes/${id}/continuity/dependencies`),
    createOutcomeContinuityDependency: (id, input) =>
      http.request(`/api/v1/outcomes/${id}/continuity/dependencies`, {
        method: 'POST',
        body: input,
      }),
    patchContinuityDependency: (id, input) =>
      http.request(`/api/v1/continuity/dependencies/${id}`, { method: 'PATCH', body: input }),
    deleteContinuityDependency: (id) =>
      http.request(`/api/v1/continuity/dependencies/${id}`, { method: 'DELETE' }),
    listContinuityProtectedBlocks: () => http.request('/api/v1/continuity/protected-blocks'),
    createContinuityProtectedBlock: (input) =>
      http.request('/api/v1/continuity/protected-blocks', { method: 'POST', body: input }),
    patchContinuityProtectedBlock: (id, input) =>
      http.request(`/api/v1/continuity/protected-blocks/${id}`, { method: 'PATCH', body: input }),
    deleteContinuityProtectedBlock: (id) =>
      http.request(`/api/v1/continuity/protected-blocks/${id}`, { method: 'DELETE' }),
  };
}
