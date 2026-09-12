import { describe, expect, it } from 'vitest';
import {
  buildClusterPrompt,
  buildDecomposePrompt,
  buildDraftPrompt,
  buildHeadlinePrompt,
  buildReportPrompt,
} from '../../src/agent/prompts.js';

const MEMORY = ['用户偏好：子任务估时不超过 30 分钟', '纠偏：不要用「冲刺」这类词'];

describe('agent prompt builders inject distilled memory', () => {
  it('headline prompt carries memory as labelled data', () => {
    const { system, user } = buildHeadlinePrompt({
      outcomeName: '换工作',
      ruleSignal: 'up',
      ruleNextStep: '改简历',
      completedLast7d: 2,
      openTasks: [{ title: '改简历', dueAt: null, overdue: false, estimateMinutes: 30 }],
      memory: MEMORY,
    });
    expect(user).toContain('从用户纠偏中学到的偏好');
    for (const item of MEMORY) expect(user).toContain(item);
    // Injection guard: memory sits inside a <data> block, and the system prompt
    // instructs the model that <data> is never instructions.
    expect(user).toMatch(/从用户纠偏中学到的偏好（参考）：\n<data>\n[\s\S]*<\/data>/);
    expect(system).toContain('<data>');
  });

  it('cluster prompt carries memory', () => {
    const { user } = buildClusterPrompt({
      existingNames: ['家庭'],
      unassignedTasks: [{ id: 't1', title: '买书', dueAt: null }],
      memory: MEMORY,
    });
    expect(user).toContain('从用户纠偏中学到的偏好');
    for (const item of MEMORY) expect(user).toContain(item);
  });

  it('decompose prompt carries memory', () => {
    const { user } = buildDecomposePrompt({
      taskTitle: '写季度总结',
      notes: '',
      deferCount: 3,
      estimateMinutes: 120,
      existingSubtasks: [],
      memory: MEMORY,
    });
    expect(user).toContain('从用户纠偏中学到的偏好');
    for (const item of MEMORY) expect(user).toContain(item);
  });

  it('report prompt wraps facts and memory in data tags', () => {
    const { system, user } = buildReportPrompt({
      title: '2026年9月11日 日报',
      periodStart: '2026-09-11',
      periodEnd: '2026-09-12',
      completed: [{ title: '写纪要' }],
      carried: [{ title: '改简历', dueAt: null }],
      captured: [{ title: '一篇文章' }],
      habits: [{ title: '喝水', done: 3, target: 8 }],
      existingNotes: '下午开了评审。',
      memory: MEMORY,
    });
    expect(system).toContain('submit_report');
    expect(system).toContain('<data>');
    expect(user).toContain('写纪要');
    expect(user).toContain('改简历');
    expect(user).toContain('一篇文章');
    expect(user).toContain('喝水 3/8');
    expect(user).toContain('下午开了评审。');
    expect(user).toMatch(/从用户纠偏中学到的偏好（参考）：\n<data>\n[\s\S]*<\/data>/);
    for (const item of MEMORY) expect(user).toContain(item);
  });

  it('omits the memory block entirely when there is none', () => {
    const { user } = buildDecomposePrompt({
      taskTitle: '写季度总结',
      notes: '',
      deferCount: 3,
      estimateMinutes: null,
      existingSubtasks: [],
      memory: [],
    });
    expect(user).not.toContain('从用户纠偏中学到的偏好');
  });
});

describe('buildDraftPrompt', () => {
  const base = {
    taskTitle: '写季度总结',
    notes: '',
    outcomeName: null as string | null,
    dueAt: null as string | null,
    estimateMinutes: null as number | null,
    existingSubtasks: [] as string[],
    memory: [] as string[],
  };

  it('asks for subtasks when the task can split', () => {
    const { system } = buildDraftPrompt({ ...base, canSplit: true });
    expect(system).toContain('submit_draft');
    expect(system).toContain('2-8');
    expect(system).toContain('子任务');
  });

  it('forbids nested subtasks when the task is already a child', () => {
    const { system } = buildDraftPrompt({ ...base, canSplit: false });
    expect(system).toContain('不要给 subtasks');
  });
});
