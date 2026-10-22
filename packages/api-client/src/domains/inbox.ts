import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';
import type { CreateInboxInput, InboxItem } from '@vital/dto';

export function bindInbox(
  http: Http,
): Pick<
  VitalClient,
  | 'extractInbox'
  | 'startInboxExtract'
  | 'getInboxExtract'
  | 'listInboxExtractJobs'
  | 'listInbox'
  | 'createInbox'
  | 'createInboxResult'
  | 'getInbox'
  | 'getInboxMarkdown'
  | 'patchInbox'
  | 'patchInboxAssets'
  | 'deleteInbox'
  | 'convertInbox'
  | 'startInboxErrand'
  | 'startTaskErrand'
  | 'exportInboxToInwit'
  | 'getInwitConfig'
  | 'putInwitConfig'
  | 'testInwit'
> {
  async function createInboxResult(
    input: CreateInboxInput,
    idempotencyKey?: string,
  ): Promise<{ item: InboxItem; created: boolean }> {
    const headers: Record<string, string> = {};
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
    const result = await http.requestWithStatus('/api/v1/inbox', {
      method: 'POST',
      body: input,
      ...(idempotencyKey !== undefined ? { headers } : {}),
    });
    return { item: result.data as InboxItem, created: result.status === 201 };
  }
  return {
    extractInbox: (input) => http.request('/api/v1/inbox/extract', { method: 'POST', body: input }),
    startInboxExtract: (input) =>
      http.request('/api/v1/inbox/extract-jobs', { method: 'POST', body: input }),
    getInboxExtract: (id) => http.request(`/api/v1/inbox/extract-jobs/${id}`),
    listInboxExtractJobs: (query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.page !== undefined) q.page = query.page;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/inbox/extract-jobs', { query: q });
    },
    listInbox: (query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.status !== undefined) q.status = query.status;
      if (query.tagId !== undefined) q.tagId = query.tagId;
      if (query.cursor !== undefined) q.cursor = query.cursor;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/inbox', { query: q });
    },
    createInbox: async (input, idempotencyKey) =>
      (await createInboxResult(input, idempotencyKey)).item,
    createInboxResult,
    getInbox: (id) => http.request(`/api/v1/inbox/${id}`),
    getInboxMarkdown: (id) => http.request(`/api/v1/inbox/${id}/markdown`),
    patchInbox: (id, input) =>
      http.request(`/api/v1/inbox/${id}`, { method: 'PATCH', body: input }),
    patchInboxAssets: (id, input) =>
      http.request(`/api/v1/inbox/${id}/assets`, { method: 'PATCH', body: input }),
    deleteInbox: (id) => http.request(`/api/v1/inbox/${id}`, { method: 'DELETE' }),
    convertInbox: (id, input = {}) =>
      http.request(`/api/v1/inbox/${id}/convert`, { method: 'POST', body: input }),
    startInboxErrand: (id) =>
      http.request(`/api/v1/inbox/${id}/errand`, { method: 'POST', body: {} }),
    startTaskErrand: (id) =>
      http.request(`/api/v1/tasks/${id}/errand`, { method: 'POST', body: {} }),
    exportInboxToInwit: (id) =>
      http.request(`/api/v1/inbox/${id}/export-inwit`, { method: 'POST', body: {} }),
    getInwitConfig: () => http.request('/api/v1/integrations/inwit'),
    putInwitConfig: (input) =>
      http.request('/api/v1/integrations/inwit', { method: 'PUT', body: input }),
    testInwit: () => http.request('/api/v1/integrations/inwit/test', { method: 'POST', body: {} }),
  };
}
