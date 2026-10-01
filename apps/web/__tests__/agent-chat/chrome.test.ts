import { describe, expect, it } from 'vitest';
import {
  AGENT_CHAT_WIDTH_DEFAULT,
  AGENT_CHAT_WIDTH_MAX,
  AGENT_CHAT_WIDTH_MIN,
  agentChatWidthFromDrag,
  agentChatWidthFromKey,
  clampAgentChatWidth,
} from '../../src/features/agent-chat/chrome';

describe('agent chat dock width', () => {
  it('clamps between the assistant min and max', () => {
    expect(clampAgentChatWidth(0)).toBe(AGENT_CHAT_WIDTH_MIN);
    expect(clampAgentChatWidth(9999)).toBe(AGENT_CHAT_WIDTH_MAX);
    expect(clampAgentChatWidth(Number.NaN)).toBe(AGENT_CHAT_WIDTH_DEFAULT);
    expect(clampAgentChatWidth(360)).toBe(360);
  });

  it('grows when the left edge is dragged left', () => {
    expect(agentChatWidthFromDrag(360, 1000, 940)).toBe(420);
    expect(agentChatWidthFromDrag(360, 1000, 1060)).toBe(300);
  });

  it('steps with the arrow keys and jumps to the ends', () => {
    expect(agentChatWidthFromKey(360, 'ArrowLeft')).toBe(376);
    expect(agentChatWidthFromKey(360, 'ArrowRight')).toBe(344);
    expect(agentChatWidthFromKey(360, 'Home')).toBe(AGENT_CHAT_WIDTH_MAX);
    expect(agentChatWidthFromKey(360, 'End')).toBe(AGENT_CHAT_WIDTH_MIN);
    expect(agentChatWidthFromKey(360, 'Enter')).toBeNull();
  });
});
