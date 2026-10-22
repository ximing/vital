import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindNotifications(
  http: Http,
): Pick<
  VitalClient,
  | 'listNotificationChannels'
  | 'createNotificationChannel'
  | 'patchNotificationChannel'
  | 'deleteNotificationChannel'
  | 'testNotificationChannel'
  | 'registerPushDevice'
> {
  return {
    listNotificationChannels: () => http.request('/api/v1/notification-channels'),
    createNotificationChannel: (input) =>
      http.request('/api/v1/notification-channels', { method: 'POST', body: input }),
    patchNotificationChannel: (id, input) =>
      http.request(`/api/v1/notification-channels/${id}`, { method: 'PATCH', body: input }),
    deleteNotificationChannel: (id) =>
      http.request(`/api/v1/notification-channels/${id}`, { method: 'DELETE' }),
    testNotificationChannel: (id) =>
      http.request(`/api/v1/notification-channels/${id}/test`, { method: 'POST' }),
    registerPushDevice: (input) =>
      http.request('/api/v1/push-devices', { method: 'POST', body: input }),
  };
}
