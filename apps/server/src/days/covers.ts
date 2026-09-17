import type { CoverPreset } from '@vital/dto';
import { COVER_PRESETS } from '@vital/dto';
import { config } from '../config.js';

export function isCoverPreset(value: string): value is CoverPreset {
  return (COVER_PRESETS as readonly string[]).includes(value);
}

export function presetCoverUrl(preset: CoverPreset): string {
  return `${config.WEB_ORIGIN.replace(/\/$/, '')}/days/${preset}.jpg`;
}
