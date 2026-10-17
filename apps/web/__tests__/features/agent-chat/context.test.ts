import { describe, expect, it } from 'vitest';
import { chatPageContext, contextTaskId } from '../../../src/features/agent-chat/context';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('chat task context', () => {
  it('prefers the defer-follow-up task query over the selected row', () => {
    expect(contextTaskId(`?task=${taskId}`, null)).toBe(taskId);
    expect(contextTaskId('?task=not-a-uuid', 'selected')).toBe('selected');
    const page = chatPageContext('/chat', `?task=${taskId}`, null);
    expect(page.section).toBe('chat');
    expect(page.listId).toBeNull();
    expect(page.taskId).toBe(taskId);
  });
});
