export const zhCN = {
  brand: {
    name: 'Vital',
    wordmark: 'Vital',
    tagline: '捕捉 · 执行 · 复盘',
  },
  nav: {
    todos: '待办',
    inbox: '稍后读',
    reports: '报告',
    search: '搜索',
    settings: '设置',
    login: '登录',
    register: '注册',
    onboarding: '开始使用',
  },
  lists: {
    inbox: '收集箱',
    today: '今天',
    upcoming: '最近',
    anytime: '随时',
    someday: '某天',
    done: '已完成',
  },
  reports: {
    daily: '日报',
    weekly: '周报',
    monthly: '月报',
    yearly: '年报',
  },
} as const;

export type Messages = typeof zhCN;
