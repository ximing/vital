export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'failed';

export function isNewerRelease(currentCode: number, remoteCode: number): boolean {
  return remoteCode > currentCode;
}

export function isForcedUpdate(
  currentCode: number,
  minVersionCode: number | undefined,
): boolean {
  return minVersionCode !== undefined && currentCode < minVersionCode;
}

export function formatProgress(downloaded: number, total: number): string {
  if (!(total > 0) || !Number.isFinite(downloaded)) return '';
  const pct = Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  return `${pct}%`;
}

export function progressRatio(downloaded: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(downloaded)) return 0;
  return Math.max(0, Math.min(1, downloaded / total));
}
