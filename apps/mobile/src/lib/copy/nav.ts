import { zhCN } from '@vital/tokens';
export const nav = {
  ...zhCN.nav,
  today: zhCN.lists.today,
  todos: zhCN.nav.todos,
  schedule: '日程',
  inbox: '收集',
  reports: '复盘',
  me: '我的',
} as const;
