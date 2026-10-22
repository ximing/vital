import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindAgent(
  http: Http,
): Pick<
  VitalClient,
  | 'getAgentUsage'
  | 'listAgentExecutions'
  | 'organizeAgentTasks'
  | 'getChatSession'
  | 'resetChat'
  | 'postChatMessage'
  | 'applyChatPreview'
  | 'applyAgentPlan'
  | 'cancelChatPreview'
  | 'undoChat'
  | 'distillAgentMemory'
  | 'getAgentMetrics'
  | 'listAgentSchedule'
  | 'cancelAgentSchedule'
  | 'listAgentActions'
  | 'sendAgentActionFeedback'
  | 'undoAgentAction'
  | 'listAgentMemory'
  | 'createAgentMemory'
  | 'patchAgentMemory'
  | 'deleteAgentMemory'
> {
  return {
    getAgentUsage: (days) =>
      http.request(`/api/v1/agent/usage${days ? `?days=${String(days)}` : ''}`),
    listAgentExecutions: (days) =>
      http.request(`/api/v1/agent/executions${days ? `?days=${String(days)}` : ''}`),
    organizeAgentTasks: () => http.request('/api/v1/agent/cluster', { method: 'POST' }),
    getChatSession: () => http.request('/api/v1/agent/chat'),
    resetChat: () => http.request('/api/v1/agent/chat/reset', { method: 'POST' }),
    postChatMessage: (input, signal) =>
      http.stream('/api/v1/agent/chat/messages', {
        method: 'POST',
        body: input,
        ...(signal ? { signal } : {}),
      }),
    applyChatPreview: (id) =>
      http.request(`/api/v1/agent/chat/previews/${id}/apply`, { method: 'POST' }),
    applyAgentPlan: (id) => http.request(`/api/v1/agent/plans/${id}/apply`, { method: 'POST' }),
    cancelChatPreview: (id) =>
      http.request(`/api/v1/agent/chat/previews/${id}/cancel`, { method: 'POST' }),
    undoChat: (hintId) =>
      http.request('/api/v1/agent/chat/undo', { method: 'POST', body: { hintId } }),
    distillAgentMemory: () => http.request('/api/v1/agent/memory/distill', { method: 'POST' }),
    getAgentMetrics: (days) =>
      http.request(`/api/v1/agent/metrics${days ? `?days=${String(days)}` : ''}`),
    listAgentSchedule: () => http.request('/api/v1/agent/schedule'),
    cancelAgentSchedule: (capability) =>
      http.request(`/api/v1/agent/schedule/${capability}/cancel`, { method: 'POST' }),
    listAgentActions: (query) =>
      http.request('/api/v1/agent/actions', {
        query: {
          targetType: query?.targetType,
          targetId: query?.targetId,
          actionType: query?.actionType,
          feedback: query?.feedback,
          days: query?.days,
        },
      }),
    sendAgentActionFeedback: (id, input) =>
      http.request(`/api/v1/agent/actions/${id}/feedback`, { method: 'POST', body: input }),
    undoAgentAction: (id) => http.request(`/api/v1/agent/actions/${id}/undo`, { method: 'POST' }),
    listAgentMemory: () => http.request('/api/v1/agent/memory'),
    createAgentMemory: (input) =>
      http.request('/api/v1/agent/memory', { method: 'POST', body: input }),
    patchAgentMemory: (id, input) =>
      http.request(`/api/v1/agent/memory/${id}`, { method: 'PATCH', body: input }),
    deleteAgentMemory: async (id) => {
      await http.request(`/api/v1/agent/memory/${id}`, { method: 'DELETE' });
    },
  };
}
