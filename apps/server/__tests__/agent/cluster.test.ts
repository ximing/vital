import { describe, expect, it } from 'vitest';
import { normalizeThreadName, resolveClusterTarget } from '../../src/agent/cluster.js';

describe('normalizeThreadName', () => {
  it('treats dated and spaced variants as the same thread', () => {
    expect(normalizeThreadName('Agent 调研')).toBe(normalizeThreadName('agent调研'));
    expect(normalizeThreadName('席铭10.26会议')).toBe(normalizeThreadName('席铭10-26会议'));
    expect(normalizeThreadName('席铭的会议【From: 席铭(Simon)】')).toBe('席铭的会议');
  });
});

describe('resolveClusterTarget', () => {
  const existing = [{ id: 'out-1', name: 'Agent 调研' }];

  it('attaches when the model names an open thread', () => {
    expect(resolveClusterTarget({ name: '另一件事', outcomeId: 'out-1' }, existing)).toEqual({
      kind: 'attach',
      outcomeId: 'out-1',
    });
  });

  it('attaches when the proposed name is the same thread', () => {
    expect(resolveClusterTarget({ name: 'agent 调研' }, existing)).toEqual({
      kind: 'attach',
      outcomeId: 'out-1',
    });
  });

  it('creates when the name is a different goal and no id matches', () => {
    expect(resolveClusterTarget({ name: '换工作', outcomeId: 'missing' }, existing)).toEqual({
      kind: 'create',
    });
  });
});
