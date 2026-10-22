export const onboarding = {
  skipAll: '跳过引导',
  next: '下一步',
  start: '开始使用',
  stepOf: '第 {n} 步，共 3 步',
  steps: [
    {
      title: '把一页收进来',
      body: '稍后读是口袋。粘贴链接，或用扩展保存当前页。',
      action: '去稍后读',
    },
    {
      title: '建一条今天的任务',
      body: '按 N 新建，按 E 完成。今天 = 逾期和今日到期。',
      action: '去今天',
    },
    {
      title: '打开周报，钉上任务',
      body: '用 / 插入任务。随时按 ⌘K 跳转到列表、稍后读和报告。',
      action: '打开周报',
    },
  ],
} as const;
