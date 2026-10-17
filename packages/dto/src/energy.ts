import { z } from 'zod';

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function blankToNull(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export const createEnergyLogSchema = z.object({
  energy: z.number().int().min(1).max(5),
  mood: z.preprocess(blankToNull, z.string().max(40).nullable()).optional(),
  note: z.preprocess(blankToNull, z.string().max(200).nullable()).optional(),
  loggedAt: z.string().optional(),
});
export type CreateEnergyLogInput = z.infer<typeof createEnergyLogSchema>;

export const energyLogQuerySchema = z
  .object({
    date: ymdSchema.optional(),
    from: ymdSchema.optional(),
    to: ymdSchema.optional(),
    since: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.date && (value.from || value.to)) {
      ctx.addIssue({ code: 'custom', message: 'date conflicts with from/to' });
    }
    if ((value.from === undefined) !== (value.to === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'from and to are a pair' });
    }
    if (value.since !== undefined && !Number.isFinite(Date.parse(value.since))) {
      ctx.addIssue({ code: 'custom', message: 'since must be an instant' });
    }
  });
export type EnergyLogQuery = z.infer<typeof energyLogQuerySchema>;

export interface EnergyLog {
  id: string;
  energy: number;
  mood: string | null;
  note: string | null;
  loggedAt: string;
  createdAt: string;
}

export interface EnergyLogList {
  items: EnergyLog[];
}
