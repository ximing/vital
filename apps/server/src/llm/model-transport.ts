import type { Api, Context, Model, MutableModels, SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { LlmModelPricing } from '@vital/dto';
import { applyModelPricing, modelIsPriced } from './pricing.js';
import { beginModelCall } from './telemetry.js';

interface ModelCall {
  userId: string;
  capability: string;
  models: MutableModels;
  model: Model<Api>;
  provider: string;
  timezone: string;
  overlay?: LlmModelPricing;
  at?: Date;
}

function pricedModel(input: ModelCall): Model<Api> {
  return applyModelPricing(input.model, input.overlay, input.timezone, input.at);
}

function begin(input: ModelCall, model: Model<Api>) {
  return beginModelCall({
    userId: input.userId, capability: input.capability,
    model: model.id, provider: input.provider,
    priced: modelIsPriced(model),
    ...(modelIsPriced(model) ? { pricedModel: model } : {}),
  });
}

/** All product completions and streams must pass through this module. */
export async function completeModel(input: ModelCall, context: Context, options: SimpleStreamOptions) {
  const model = pricedModel(input);
  const finish = await begin(input, model);
  try {
    const message = await input.models.completeSimple(model, context, options);
    await finish(message);
    return message;
  } catch (error) {
    await finish(undefined, error);
    throw error;
  }
}

export async function streamModel(input: ModelCall, context: Context, options: SimpleStreamOptions) {
  const model = pricedModel(input);
  const finish = await begin(input, model);
  try {
    const stream = input.models.streamSimple(model, context, options);
    const finished = stream.result().then(
      (message) => finish(message),
      (error: unknown) => finish(undefined, error),
    );
    // A caller awaits this in finally; attach a handler immediately to avoid
    // an unhandled rejection while the Agent is still consuming the stream.
    void finished.catch(() => {});
    return { stream, finished };
  } catch (error) {
    await finish(undefined, error);
    throw error;
  }
}
