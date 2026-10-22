export const onboarding = {
  skipAll: '跳过引导',
  next: '下一步',
  start: '开始使用',
  steps: [
    {
      title: '把一页收进来',
      body: '稍后读是口袋。粘贴链接，先把想读的页丢进来。',
      action: '去稍后读',
    },
    {
      title: '建一条今天的任务',
      body: '从今天下手。完成后可以撤销。',
      action: '去今天',
    },
    {
      title: '打开周报，钉上任务',
      body: '周报会留下这一周的痕迹。把完成的任务钉进去。',
      action: '打开报告',
    },
  ],
} as const;
