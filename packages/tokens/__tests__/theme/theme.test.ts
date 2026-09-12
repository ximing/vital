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
    expect(sharedTokens.type.section).toEqual({ fontSize: 16, lineHeight: 24 });
    expect(sharedTokens.type.display).toEqual({ fontSize: 26, lineHeight: 34 });
  });

  it('locks the inbox source hues', () => {
    expect(lightColors.srcExtension).toBe('#6A5CD0');
    expect(lightColors.srcWechat).toBe('#229E4E');
    expect(lightColors.srcWeb).toBe('#3D6FD1');
    expect(lightColors.srcMobile).toBe('#B4761E');
    expect(lightColors.srcManual).toBe('#2C9C8C');
    expect(darkColors.srcExtension).toBe('#9D8EF0');
    expect(darkColors.srcWechat).toBe('#5CCF82');
    expect(darkColors.srcWeb).toBe('#7FA8F0');
    expect(darkColors.srcMobile).toBe('#E0A94E');
    expect(darkColors.srcManual).toBe('#5CC9B8');
  });
});
