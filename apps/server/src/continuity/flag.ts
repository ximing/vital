import { config } from '../config.js';

let override: boolean | null = null;

export function isContinuityEnabled(): boolean {
  return override ?? config.CONTINUITY_ENABLED;
}

/** Test seam. Pass null to restore the env value. */
export function setContinuityEnabledForTest(value: boolean | null): void {
  override = value;
}
