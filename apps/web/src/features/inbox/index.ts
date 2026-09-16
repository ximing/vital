/** Public API for other features. Workspace roots stay file-imported (App lazy + cycle break). */
export { InboxUiService, inboxUi, resetInboxUi } from './inbox-ui.service';
export {
  PASTE_URL_ID,
  filterSaves,
  inboxHref,
  parseInboxFilter,
  parseInboxTagId,
  type InboxFilter,
} from './model';
export { useOnline } from './online';
export { inboxKeys } from './query-keys';
export { useInboxActions, useInboxItemQuery, useInboxListQuery } from './queries';
