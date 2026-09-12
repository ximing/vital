import { parseLlmParameters, type LlmParameters } from '@vital/dto';

export function routeKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

export function parseRouteKey(value: string): { providerId: string; model: string } | null {
  const sep = value.indexOf('::');
  if (sep <= 0) return null;
  const providerId = value.slice(0, sep);
  const model = value.slice(sep + 2);
  if (providerId === '' || model === '') return null;
  return { providerId, model };
}

export function parseModelParameters(
  models: string[],
  drafts: Record<string, string>,
): Record<string, LlmParameters> {
  return Object.fromEntries(models.map((id) => [id, parseLlmParameters(drafts[id] ?? '')]));
}
