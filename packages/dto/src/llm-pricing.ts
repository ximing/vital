import { z } from 'zod';

/** USD per million tokens — same unit as the pi-ai catalog. */
export const LLM_COST_RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
export type LlmCostRateKey = (typeof LLM_COST_RATE_KEYS)[number];

export interface LlmResolvedCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type LlmCostRates = {
  [K in LlmCostRateKey]?: number | undefined;
};

export interface LlmCostWindow extends LlmCostRates {
  /** Inclusive start, `HH:mm` in the account timezone. */
  start: string;
  /** Exclusive end, `HH:mm`. `start > end` wraps past midnight. */
  end: string;
}

export interface LlmModelPricing extends LlmCostRates {
  windows?: LlmCostWindow[] | undefined;
}

export interface LlmCostRatesDraft {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

export interface LlmCostWindowDraft extends LlmCostRatesDraft {
  start: string;
  end: string;
}

export interface LlmModelPricingDraft extends LlmCostRatesDraft {
  windows: LlmCostWindowDraft[];
}

const hmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'INVALID_HM' });
const rateSchema = z.number().finite().min(0).max(1_000_000);
const modelIdSchema = z.string().trim().min(1).max(128);

export const llmCostRatesSchema = z.object({
  input: rateSchema.optional(),
  output: rateSchema.optional(),
  cacheRead: rateSchema.optional(),
  cacheWrite: rateSchema.optional(),
});

export function hasLlmCostRates(rates: LlmCostRates | undefined): boolean {
  if (!rates) return false;
  return (
    rates.input !== undefined ||
    rates.output !== undefined ||
    rates.cacheRead !== undefined ||
    rates.cacheWrite !== undefined
  );
}

export function hasLlmPricing(pricing: LlmModelPricing | undefined): boolean {
  return hasLlmCostRates(pricing) || (pricing?.windows?.some((window) => hasLlmCostRates(window)) ?? false);
}

export const llmCostWindowSchema = llmCostRatesSchema
  .extend({
    start: hmSchema,
    end: hmSchema,
  })
  .superRefine((value, ctx) => {
    if (value.start === value.end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '时段起止不能相同', path: ['end'] });
    }
    if (!hasLlmCostRates(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '时段至少填写一个单价' });
    }
  });

export const llmModelPricingSchema = llmCostRatesSchema.extend({
  windows: z.array(llmCostWindowSchema).max(24).optional(),
});

export const llmModelPricingMapSchema = z
  .record(modelIdSchema, llmModelPricingSchema)
  .refine((value) => Object.keys(value).length <= 50, '最多配置 50 个模型');

export function llmCostIsPriced(cost: LlmResolvedCost): boolean {
  return cost.input > 0 || cost.output > 0 || cost.cacheRead > 0 || cost.cacheWrite > 0;
}

export function hmToMinutes(hm: string): number {
  const [hour, minute] = hm.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** Inclusive start, exclusive end. `start > end` wraps past midnight. */
export function minutesInHmWindow(minutes: number, start: string, end: string): boolean {
  const from = hmToMinutes(start);
  const to = hmToMinutes(end);
  if (from === to) return false;
  if (from < to) return minutes >= from && minutes < to;
  return minutes >= from || minutes < to;
}

function minutesUtc(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

/** Minute-of-day in `timeZone`, 0–1439. Invalid zones fall back to UTC. */
export function minutesOfDayInZone(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(at);
    let hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return minutesUtc(at);
    if (hour === 24) hour = 0;
    return hour * 60 + minute;
  } catch {
    return minutesUtc(at);
  }
}

function pickRate(
  key: LlmCostRateKey,
  catalog: LlmResolvedCost,
  overlay: LlmModelPricing,
  window: LlmCostWindow | undefined,
): number {
  if (window?.[key] !== undefined) return window[key];
  if (overlay[key] !== undefined) return overlay[key];
  return catalog[key];
}

/**
 * Overlay wins field-by-field; missing overlay fields keep the catalog rate.
 * `source: 'catalog'` means the caller should keep the original catalog table
 * (including volume tiers). Overlay is always a flat rate table.
 */
export function resolveLlmCost(
  catalog: LlmResolvedCost,
  overlay: LlmModelPricing | undefined,
  at: Date,
  timeZone: string,
): { cost: LlmResolvedCost; source: 'catalog' | 'overlay' } {
  if (!hasLlmPricing(overlay) || overlay === undefined) {
    return { cost: catalog, source: 'catalog' };
  }
  const minutes = minutesOfDayInZone(at, timeZone);
  const window = overlay.windows?.find(
    (item) => hasLlmCostRates(item) && minutesInHmWindow(minutes, item.start, item.end),
  );
  if (window === undefined && !hasLlmCostRates(overlay)) {
    return { cost: catalog, source: 'catalog' };
  }
  return {
    source: 'overlay',
    cost: {
      input: pickRate('input', catalog, overlay, window),
      output: pickRate('output', catalog, overlay, window),
      cacheRead: pickRate('cacheRead', catalog, overlay, window),
      cacheWrite: pickRate('cacheWrite', catalog, overlay, window),
    },
  };
}

function compactRates(rates: LlmCostRates): LlmCostRates {
  const next: LlmCostRates = {};
  for (const key of LLM_COST_RATE_KEYS) {
    if (rates[key] !== undefined) next[key] = rates[key];
  }
  return next;
}

export function compactLlmModelPricing(
  pricing: LlmModelPricing | undefined,
): LlmModelPricing | undefined {
  if (!pricing) return undefined;
  const rates = compactRates(pricing);
  const windows = pricing.windows
    ?.filter((window) => hasLlmCostRates(window) && window.start !== window.end)
    .map((window) => ({
      start: window.start,
      end: window.end,
      ...compactRates(window),
    }));
  const next: LlmModelPricing = { ...rates };
  if (windows && windows.length > 0) next.windows = windows;
  return hasLlmPricing(next) ? next : undefined;
}

export function compactLlmModelPricingMap(
  map: Record<string, LlmModelPricing> | undefined,
  models: string[],
): Record<string, LlmModelPricing> | undefined {
  if (!map) return undefined;
  const allowed = new Set(models);
  const out: Record<string, LlmModelPricing> = {};
  for (const [id, pricing] of Object.entries(map)) {
    if (!allowed.has(id)) continue;
    const compact = compactLlmModelPricing(pricing);
    if (compact) out[id] = compact;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function emptyLlmCostRatesDraft(): LlmCostRatesDraft {
  return { input: '', output: '', cacheRead: '', cacheWrite: '' };
}

export function emptyLlmModelPricingDraft(): LlmModelPricingDraft {
  return { ...emptyLlmCostRatesDraft(), windows: [] };
}

function formatRate(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

export function llmModelPricingToDraft(pricing?: LlmModelPricing): LlmModelPricingDraft {
  return {
    input: formatRate(pricing?.input),
    output: formatRate(pricing?.output),
    cacheRead: formatRate(pricing?.cacheRead),
    cacheWrite: formatRate(pricing?.cacheWrite),
    windows: (pricing?.windows ?? []).map((window) => ({
      start: window.start,
      end: window.end,
      input: formatRate(window.input),
      output: formatRate(window.output),
      cacheRead: formatRate(window.cacheRead),
      cacheWrite: formatRate(window.cacheWrite),
    })),
  };
}

export function parseLlmRateField(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error('单价必须是 0 到 1000000 之间的数字');
  }
  return value;
}

function parseDraftRates(draft: LlmCostRatesDraft): LlmCostRates {
  const rates: LlmCostRates = {};
  for (const key of LLM_COST_RATE_KEYS) {
    const value = parseLlmRateField(draft[key]);
    if (value !== undefined) rates[key] = value;
  }
  return rates;
}

function normalizeHm(raw: string): string {
  const trimmed = raw.trim();
  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(trimmed)) return trimmed.slice(0, 5);
  return trimmed;
}

export function parseLlmModelPricingDraft(draft: LlmModelPricingDraft): LlmModelPricing | undefined {
  const rates = parseDraftRates(draft);
  const windows: LlmCostWindow[] = [];
  for (const window of draft.windows) {
    const start = normalizeHm(window.start);
    const end = normalizeHm(window.end);
    const windowRates = parseDraftRates(window);
    if (start === '' && end === '' && !hasLlmCostRates(windowRates)) continue;
    const parsedStart = hmSchema.safeParse(start);
    const parsedEnd = hmSchema.safeParse(end);
    if (!parsedStart.success || !parsedEnd.success) {
      throw new Error('时段需为 HH:mm');
    }
    if (start === end) throw new Error('时段起止不能相同');
    if (!hasLlmCostRates(windowRates)) throw new Error('时段至少填写一个单价');
    windows.push({ start, end, ...windowRates });
  }
  return compactLlmModelPricing({ ...rates, ...(windows.length > 0 ? { windows } : {}) });
}

export function parseLlmModelPricingMap(
  models: string[],
  drafts: Record<string, LlmModelPricingDraft>,
): Record<string, LlmModelPricing> | undefined {
  const out: Record<string, LlmModelPricing> = {};
  for (const id of models) {
    const parsed = parseLlmModelPricingDraft(drafts[id] ?? emptyLlmModelPricingDraft());
    if (parsed) out[id] = parsed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
