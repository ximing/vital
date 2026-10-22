import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';

export function bindLlm(
  http: Http,
): Pick<
  VitalClient,
  | 'llmCatalog'
  | 'addLlmProvider'
  | 'patchLlmProvider'
  | 'removeLlmProvider'
  | 'testLlmProvider'
  | 'putLlmRouting'
> {
  return {
    llmCatalog: () => http.request('/api/v1/llm/catalog'),
    addLlmProvider: (input) =>
      http.request('/api/v1/llm/providers', { method: 'POST', body: input }),
    patchLlmProvider: (id, input) =>
      http.request(`/api/v1/llm/providers/${id}`, { method: 'PATCH', body: input }),
    removeLlmProvider: (id) => http.request(`/api/v1/llm/providers/${id}`, { method: 'DELETE' }),
    testLlmProvider: (id, model) =>
      http.request(`/api/v1/llm/providers/${id}/test`, {
        method: 'POST',
        body: { providerId: id, model },
      }),
    putLlmRouting: (input) => http.request('/api/v1/llm/routing', { method: 'PUT', body: input }),
  };
}
