export { ApiError, type TokenStore, type VitalClientOptions } from './types.js';
export {
  Http,
  isAuthResponse,
  isSessionInvalidError,
  tokensForStore,
  type BootResult,
  type RequestOptions,
} from './http.js';
export { createVitalClient, type VitalClient } from './client.js';
export {
  latestUpdatedAt,
  mergeInboxItems,
  mergeReportListItems,
  mergeTasksIntoList,
  syncEventsUrl,
  syncHeadMoved,
} from './sync.js';
export { uploadImpl, type UploadInput } from './upload.js';
