import { DEFAULT_LLM_SETTINGS, type LlmSettingsPublic } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { chatModelChoices, routingWithChatModel, selectedChatModel } from '../../src/features/agent-chat/models';

const llm: LlmSettingsPublic = {
  providers: [
    { id: 'p1', providerId: 'openai', label: 'OpenAI', baseUrl: null, models: ['gpt'], apiKeySet: true },
    { id: 'p2', providerId: 'custom', label: '本地', baseUrl: null, models: ['glm'], apiKeySet: false },
  ],
  routing: { default: { providerId: 'p1', model: 'gpt' } },
};

describe('chat model choices', () => {
  it('lists only providers that have a key', () => {
    expect(chatModelChoices(llm).map((item) => item.label)).toEqual(['gpt · OpenAI']);
    expect(chatModelChoices(DEFAULT_LLM_SETTINGS)).toEqual([]);
  });

  it('shows the chat route, then the default route', () => {
    expect(selectedChatModel(llm)?.model).toBe('gpt');
    expect(selectedChatModel({ ...llm, routing: { ...llm.routing, 'agent.chat': { providerId: 'p1', model: 'gpt' } } })?.value).toBe(
      'p1::gpt',
    );
  });

  it('pins agent.chat and keeps the other routes', () => {
    const next = routingWithChatModel(llm, 'p1::gpt');
    expect(next?.default).toEqual({ providerId: 'p1', model: 'gpt' });
    expect(next?.['agent.chat']).toEqual({ providerId: 'p1', model: 'gpt' });
    expect(routingWithChatModel(llm, 'missing::gpt')).toBeNull();
  });
});
