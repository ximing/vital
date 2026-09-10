import type { Api, Context, Model, MutableModels, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { beginModelCall } from './telemetry.js';

interface ModelCall {
  userId: string;
  capability: string;
  models: MutableModels;
  model: Model<Api>;
  provider: string;
}

function begin(input: ModelCall) {
  return beginModelCall({
    userId: input.userId, capability: input.capability,
    model: input.model.id, provider: input.provider,
    priced: Object.values(input.model.cost).some((rate) => rate > 0),
  });
}

/** All product completions and streams must pass through this module. */
export async function completeModel(input: ModelCall, context: Context, options: SimpleStreamOptions) {
  const finish = await begin(input);
  try {
    const message = await input.models.completeSimple(input.model, context, options);
    await finish(message);
    return message;
  } catch (error) {
    await finish(undefined, error);
    throw error;
  }
}

export async function streamModel(input: ModelCall, context: Context, options: SimpleStreamOptions) {
  const finish = await begin(input);
  try {
    const stream = input.models.streamSimple(input.model, context, options);
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
