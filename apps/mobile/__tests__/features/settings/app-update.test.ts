import { describe, expect, it } from 'vitest';
import {
  formatProgress,
  isForcedUpdate,
  isNewerRelease,
  progressRatio,
} from '../../../src/features/settings/app-update';

describe('app update helpers', () => {
  it('compares versionCode for newer and forced updates', () => {
    expect(isNewerRelease(1, 2)).toBe(true);
    expect(isNewerRelease(2, 2)).toBe(false);
    expect(isNewerRelease(3, 2)).toBe(false);
    expect(isForcedUpdate(3, 5)).toBe(true);
    expect(isForcedUpdate(5, 5)).toBe(false);
    expect(isForcedUpdate(6, 5)).toBe(false);
    expect(isForcedUpdate(1, undefined)).toBe(false);
  });

  it('formats download progress', () => {
    expect(formatProgress(0, 0)).toBe('');
    expect(formatProgress(10, 40)).toBe('25%');
    expect(formatProgress(40, 40)).toBe('100%');
    expect(progressRatio(10, 40)).toBe(0.25);
    expect(progressRatio(0, 0)).toBe(0);
    expect(progressRatio(50, 40)).toBe(1);
  });
});
