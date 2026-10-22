import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';
import type { VitalClientOptions } from '../types.js';
import { uploadImpl } from '../upload.js';

export function bindUploads(
  http: Http,
  options: VitalClientOptions,
): Pick<VitalClient, 'abortUpload' | 'discardUpload' | 'upload' | 'bindUpload' | 'getUploadUrl'> {
  return {
    abortUpload: (id) => http.request(`/api/v1/uploads/${id}/abort`, { method: 'POST' }),
    discardUpload: (id) => http.request(`/api/v1/uploads/${id}`, { method: 'DELETE' }),
    upload: (input) => uploadImpl(http, options, input),
    bindUpload: (id, input) =>
      http.request(`/api/v1/uploads/${id}/bind`, { method: 'POST', body: input }),
    getUploadUrl: (id) => http.request(`/api/v1/uploads/${id}/url`),
  };
}
