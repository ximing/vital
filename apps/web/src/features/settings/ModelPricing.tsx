import {
  emptyLlmCostRatesDraft,
  llmCostIsPriced,
  parseLlmModelPricingDraft,
  type LlmCatalogModel,
  type LlmCostRateKey,
  type LlmModelPricingDraft,
} from '@vital/dto';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

const copy = t.settings.llm;

const RATE_FIELDS: { key: LlmCostRateKey; label: string }[] = [
  { key: 'input', label: copy.pricingInput },
  { key: 'output', label: copy.pricingOutput },
  { key: 'cacheRead', label: copy.pricingCacheRead },
  { key: 'cacheWrite', label: copy.pricingCacheWrite },
];

function catalogHint(model?: LlmCatalogModel): string {
  const cost = model?.cost;
  if (!cost || !llmCostIsPriced(cost)) return copy.pricingCatalogUnpriced;
  return copy.pricingCatalog
    .replace('{input}', String(cost.input))
    .replace('{output}', String(cost.output));
}

function placeholderFor(model: LlmCatalogModel | undefined, key: LlmCostRateKey): string {
  const cost = model?.cost?.[key];
  return cost !== undefined && cost > 0 ? String(cost) : '—';
}

export function ModelPricing({
  modelId,
  model,
  draft,
  onChange,
}: {
  modelId: string;
  model?: LlmCatalogModel | undefined;
  draft: LlmModelPricingDraft;
  onChange: (next: LlmModelPricingDraft) => void;
}) {
  let error = '';
  try {
    parseLlmModelPricingDraft(draft);
  } catch (err) {
    error = err instanceof Error ? err.message : copy.parametersInvalid;
  }

  function setRate(key: LlmCostRateKey, value: string): void {
    onChange({ ...draft, [key]: value });
  }

  function setWindow(index: number, patch: Partial<LlmModelPricingDraft['windows'][number]>): void {
    onChange({
      ...draft,
      windows: draft.windows.map((window, i) => (i === index ? { ...window, ...patch } : window)),
    });
  }

  return (
    <details className="rounded-xl border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {copy.pricing} · {modelId}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-muted">
          {catalogHint(model)}。{copy.pricingHint}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {RATE_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={`${field.label} · ${field.key}`}
              type="number"
              min={0}
              max={1_000_000}
              step="any"
              value={draft[field.key]}
              placeholder={placeholderFor(model, field.key)}
              onChange={(event) => setRate(field.key, event.target.value)}
            />
          ))}
        </div>
        {draft.windows.map((window, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-lg border border-border/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-fg">
                {copy.pricingWindow} {index + 1}
              </p>
              <Button
                type="button"
                variant="quiet"
                onClick={() =>
                  onChange({ ...draft, windows: draft.windows.filter((_, i) => i !== index) })
                }
              >
                {copy.pricingRemoveWindow}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={copy.pricingWindowStart}
                type="time"
                value={window.start}
                onChange={(event) => setWindow(index, { start: event.target.value })}
              />
              <Field
                label={copy.pricingWindowEnd}
                type="time"
                value={window.end}
                onChange={(event) => setWindow(index, { end: event.target.value })}
              />
              {RATE_FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={`${field.label} · ${field.key}`}
                  type="number"
                  min={0}
                  max={1_000_000}
                  step="any"
                  value={window[field.key]}
                  placeholder={placeholderFor(model, field.key)}
                  onChange={(event) => setWindow(index, { [field.key]: event.target.value })}
                />
              ))}
            </div>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="quiet"
            onClick={() =>
              onChange({
                ...draft,
                windows: [...draft.windows, { start: '00:00', end: '08:00', ...emptyLlmCostRatesDraft() }],
              })
            }
          >
            {copy.pricingAddWindow}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
