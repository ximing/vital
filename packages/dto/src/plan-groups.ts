import { z } from 'zod';

/** Cross-item plan unit: every member applies, or the whole group is skipped. */
export const planDependencyGroupSchema = z.object({
  id: z.string().min(1).max(80),
  taskIds: z.array(z.string().uuid()).min(1).max(20),
});
export type PlanDependencyGroup = z.infer<typeof planDependencyGroupSchema>;

/** Protected-block identity + version captured at preview. */
export const planProtectedBlockVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(0),
  label: z.string().min(1).max(120),
});
export type PlanProtectedBlockVersion = z.infer<typeof planProtectedBlockVersionSchema>;
