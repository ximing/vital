import { resolveLlmRoute, type LlmRouting, type LlmSettingsPublic } from '@vital/dto';
import { llmRouteKey } from '@/features/settings/llm.service';

export interface ChatModelChoice {
  value: string;
  model: string;
  label: string;
}

export function chatModelChoices(llm: LlmSettingsPublic): ChatModelChoice[] {
  const choices: ChatModelChoice[] = [];
  for (const provider of llm.providers) {
    if (!provider.apiKeySet) continue;
    for (const model of provider.models) {
      choices.push({
        value: llmRouteKey(provider.id, model),
        model,
        label: `${model} · ${provider.label}`,
      });
    }
  }
  return choices;
}

export function selectedChatModel(llm: LlmSettingsPublic): ChatModelChoice | null {
  const route = resolveLlmRoute(llm, 'agent.chat');
  if (!route) return null;
  const provider = llm.providers.find((item) => item.id === route.providerId);
  return {
    value: llmRouteKey(route.providerId, route.model),
    model: route.model,
    label: provider ? `${route.model} · ${provider.label}` : route.model,
  };
}

/** Pin the assistant to one configured model without dropping the other routes. */
export function routingWithChatModel(llm: LlmSettingsPublic, value: string): LlmRouting | null {
  const split = value.indexOf('::');
  if (split <= 0) return null;
  const providerId = value.slice(0, split);
  const model = value.slice(split + 2);
  const known = llm.providers.some((provider) => provider.id === providerId && provider.models.includes(model));
  if (!known) return null;
  return { ...llm.routing, 'agent.chat': { providerId, model } };
}
