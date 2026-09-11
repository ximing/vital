import { LLM_CAPABILITIES, agentActionTypeSchema } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_ACTION_MAP,
  KNOWN_UNMAPPED_ACTION_TYPES,
  capabilityOfActionType,
} from '../../src/agent/eval/capability-map.js';

/**
 * The capability strings actually written to agent_usage.capability:
 * beginModelCall (llm/telemetry.ts) stores its `capability` argument with the
 * agent/task prefix stripped, so the universe is LLM_CAPABILITIES (stripped)
 * plus the retrieval (agent.embed / agent.rerank) and connection-test callers.
 */
const writtenUsageCapabilities = new Set<string>([
  ...LLM_CAPABILITIES.map((capability) => capability.replace(/^(agent|task)\./, '')),
  'embed',
  'rerank',
  'llm.test',
]);

describe('capability ↔ actionType map', () => {
  it('every mapped usage capability is a value actually written to agent_usage.capability', () => {
    for (const capability of Object.keys(CAPABILITY_ACTION_MAP)) {
      expect(writtenUsageCapabilities.has(capability), capability).toBe(true);
    }
  });

  it('every mapped actionType exists in agentActionTypeSchema', () => {
    for (const actionTypes of Object.values(CAPABILITY_ACTION_MAP)) {
      for (const actionType of actionTypes) {
        expect(agentActionTypeSchema.options).toContain(actionType);
      }
    }
  });

  it('every schema actionType is mapped or explicitly known-unmapped (drift alarm)', () => {
    const mapped = new Set<string>(Object.values(CAPABILITY_ACTION_MAP).flat());
    const unmapped = KNOWN_UNMAPPED_ACTION_TYPES as readonly string[];
    for (const actionType of agentActionTypeSchema.options) {
      expect(mapped.has(actionType) || unmapped.includes(actionType), actionType).toBe(true);
    }
  });

  it('no actionType is claimed by two capabilities', () => {
    const all = Object.values(CAPABILITY_ACTION_MAP).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('capabilityOfActionType reverse-lookups and rejects unmapped types', () => {
    expect(capabilityOfActionType('outcome.suggestion')).toBe('headline');
    expect(capabilityOfActionType('outcome.headline')).toBe('headline');
    expect(capabilityOfActionType('task.draft')).toBe('draft');
    expect(capabilityOfActionType('habit.create')).toBeNull();
  });
});
