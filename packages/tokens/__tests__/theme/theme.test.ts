import { describe, expect, it } from 'vitest';
import { darkColors, lightColors, sharedTokens } from '../../src/theme.js';

describe('Emerald Garden tokens', () => {
  it('uses the emerald light palette', () => {
    expect(lightColors.bgCanvas).toBe('#F3F5F2');
    expect(lightColors.accentPrimary).toBe('#1C7A4F');
    expect(lightColors.accentDeep).toBe('#155E3D');
  });

  it('uses a luminous mint accent on a warm-ink dark palette', () => {
    expect(darkColors.bgCanvas).toBe('#0F1210');
    expect(darkColors.bgSurface).toBe('#161A17');
    expect(darkColors.accentPrimary).toBe('#5FD3A1');
  });

  it('uses the softened radius scale and compact controls', () => {
    expect(sharedTokens.radius).toMatchObject({ sm: 6, md: 10, lg: 14, xl: 20 });
    expect(sharedTokens.controlH).toBe(36);
    expect(sharedTokens.controlHProminent).toBe(40);
  });

  it('keeps the restrained editorial type scale', () => {
    expect(sharedTokens.type.body).toEqual({ fontSize: 14, lineHeight: 21 });
    expect(sharedTokens.type.display).toEqual({ fontSize: 26, lineHeight: 34 });
  });
});
