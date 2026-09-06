export const SAMPLE_TAG = 'sample';

export const SAMPLE_TITLES = [
  '欢迎使用 Vital',
  '按 E 完成这条任务',
  '打开周报，把任务钉进去',
] as const;

export function assertDevelopmentSeed(nodeEnv: string): void {
  if (nodeEnv !== 'development') {
    throw new Error('SEED_DEV_ONLY');
  }
}
