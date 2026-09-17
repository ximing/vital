import { calculateCost, type Api, type Model, type Usage } from '@earendil-works/pi-ai';
import { llmCostIsPriced, resolveLlmCost, type LlmModelPricing } from '@vital/dto';

export function applyModelPricing(
  model: Model<Api>,
  overlay: LlmModelPricing | undefined,
  timeZone: string,
  at = new Date(),
): Model<Api> {
  const resolved = resolveLlmCost(
    {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
    overlay,
    at,
    timeZone,
  );
  if (resolved.source === 'catalog') return model;
  return { ...model, cost: resolved.cost };
}

export function modelIsPriced(model: Model<Api>): boolean {
  return llmCostIsPriced({
    input: model.cost.input,
    output: model.cost.output,
    cacheRead: model.cost.cacheRead,
    cacheWrite: model.cost.cacheWrite,
  });
}

/** Recompute USD from frozen rates × returned tokens. Do not trust provider/SDK cost fields. */
export function costMicrosFromUsage(model: Model<Api>, usage: Usage): number {
  const billed: Usage = {
    ...usage,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return Math.round(calculateCost(model, billed).total * 1_000_000);
}
