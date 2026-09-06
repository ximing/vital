import { describe, expect, it } from 'vitest';
import { darkColors, lightColors, sharedTokens } from '../../src/theme.js';

describe('Mineral Garden tokens', () => {
  it('uses the limestone and sage light palette', () => {
    expect(lightColors.bgCanvas).toBe('#F3F3ED');
    expect(lightColors.accentPrimary).toBe('#697C65');
    expect(lightColors.accentDeep).toBe('#425246');
  });

  it('keeps dark mode plant-grey instead of neutral black', () => {
    expect(darkColors.bgCanvas).toBe('#191C19');
    expect(darkColors.bgSurface).toBe('#20231F');
    expect(darkColors.accentPrimary).toBe('#A0B497');
  });

  it('uses the compact control and radius scale', () => {
    expect(sharedTokens.radius).toMatchObject({ sm: 6, md: 8, lg: 12, xl: 16 });
    expect(sharedTokens.controlH).toBe(36);
    expect(sharedTokens.controlHProminent).toBe(40);
  });
});
