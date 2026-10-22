import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindTasks(
  http: Http,
): Pick<
  VitalClient,
  | 'listTasks'
  | 'taskCounts'
  | 'createTask'
  | 'createTaskFromText'
  | 'syncDeviceCalendar'
  | 'getTask'
  | 'patchTask'
  | 'getTaskDraft'
  | 'draftTask'
  | 'deleteTask'
  | 'completeTask'
  | 'uncompleteTask'
  | 'restoreTask'
  | 'reorderTasks'
  | 'calendar'
> {
  return {
    listTasks: (query) => {
      const q: Record<string, string | number | boolean | undefined> = { listId: query.listId };
      if (query.cursor !== undefined) q.cursor = query.cursor;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/tasks', { query: q });
    },
    taskCounts: () => http.request('/api/v1/tasks/counts'),
    createTask: (input) => http.request('/api/v1/tasks', { method: 'POST', body: input }),
    createTaskFromText: (input) =>
      http.request('/api/v1/tasks/from-text', { method: 'POST', body: input }),
    syncDeviceCalendar: (input) =>
      http.request('/api/v1/tasks/device-calendar', { method: 'POST', body: input }),
    getTask: (id) => http.request(`/api/v1/tasks/${id}`),
    patchTask: (id, input) => http.request(`/api/v1/tasks/${id}`, { method: 'PATCH', body: input }),
    getTaskDraft: (id) => http.request(`/api/v1/tasks/${id}/draft`),
    draftTask: (id) => http.request(`/api/v1/tasks/${id}/draft`, { method: 'POST', body: {} }),
    deleteTask: (id) => http.request(`/api/v1/tasks/${id}`, { method: 'DELETE' }),
    completeTask: (id) =>
      http.request(`/api/v1/tasks/${id}/complete`, { method: 'POST', body: {} }),
    uncompleteTask: (id, input) =>
      http.request(`/api/v1/tasks/${id}/uncomplete`, { method: 'POST', body: input }),
    restoreTask: (id) => http.request(`/api/v1/tasks/${id}/restore`, { method: 'POST', body: {} }),
    reorderTasks: (input) => http.request('/api/v1/tasks/reorder', { method: 'PUT', body: input }),
    calendar: (query) =>
      http.request('/api/v1/tasks/calendar', { query: { from: query.from, to: query.to } }),
  };
}
