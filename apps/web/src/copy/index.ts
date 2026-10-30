/** Web UI is zh-CN. Shared keys live in @vital/tokens; screen copy stays here until i18n grows. */

import { brand } from './brand';
import { nav } from './nav';
import { dialog } from './dialog';
import { docFind } from './docFind';
import { calendar } from './calendar';
import { lists } from './lists';
import { reports } from './reports';
import { rail } from './rail';
import { today } from './today';
import { thread } from './thread';
import { days } from './days';
import { theme } from './theme';
import { auth } from './auth';
import { empty } from './empty';
import { onboarding } from './onboarding';
import { checklist } from './checklist';
import { palette } from './palette';
import { shortcuts } from './shortcuts';
import { agentChat } from './agentChat';
import { search } from './search';
import { todos } from './todos';
import { inbox } from './inbox';
import { settings } from './settings';
import { boot } from './boot';
import { route } from './route';
import { landing } from './landing';
import { schedule } from './schedule';

export const t = {
  brand,
  nav,
  dialog,
  docFind,
  calendar,
  lists,
  reports,
  rail,
  today,
  thread,
  days,
  theme,
  auth,
  empty,
  onboarding,
  checklist,
  palette,
  shortcuts,
  agentChat,
  search,
  todos,
  inbox,
  settings,
  boot,
  route,
  landing,
  schedule,
} as const;
