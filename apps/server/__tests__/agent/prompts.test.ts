import { describe, expect, it } from 'vitest';
import {
  buildClusterPrompt,
  buildDecomposePrompt,
  buildHeadlinePrompt,
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
