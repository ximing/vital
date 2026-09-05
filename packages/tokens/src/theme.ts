export interface ColorTokens {
  bgCanvas: string;
  bgSurface: string;
  bgSurfaceMuted: string;
  bgAccentSubtle: string;
  fgPrimary: string;
  fgMuted: string;
  fgOnAccent: string;
  borderSubtle: string;
  borderFocus: string;
  accentPrimary: string;
  accentPrimaryHover: string;
  statusTodo: string;
  statusDoing: string;
  statusDone: string;
  statusOverdue: string;
  statusDueSoon: string;
  reportDaily: string;
  reportWeekly: string;
  reportMonthly: string;
  reportYearly: string;
  danger: string;
  scrim: string;
}

export const lightColors: ColorTokens = {
  bgCanvas: '#F4F7F6',
  bgSurface: '#FFFFFF',
  bgSurfaceMuted: '#E8EEEC',
  bgAccentSubtle: '#D7F3F1',
  fgPrimary: '#0E1A24',
  fgMuted: '#5B6B72',
  fgOnAccent: '#FFFFFF',
  borderSubtle: '#D5DEDB',
  borderFocus: '#0F8F8A',
  accentPrimary: '#0F8F8A',
  accentPrimaryHover: '#0A5C5A',
  statusTodo: '#5B6B72',
  statusDoing: '#2F6F8F',
  statusDone: '#3B7D4F',
  statusOverdue: '#C45C6A',
  statusDueSoon: '#C9842A',
  reportDaily: '#0F8F8A',
  reportWeekly: '#2F6F8F',
  reportMonthly: '#C9842A',
  reportYearly: '#5B4B8A',
  danger: '#C45C6A',
  scrim: 'rgb(14 26 36 / 40%)',
};

export const darkColors: ColorTokens = {
  bgCanvas: '#0B1214',
  bgSurface: '#1A2A2E',
  bgSurfaceMuted: '#22363B',
  bgAccentSubtle: '#163836',
  fgPrimary: '#E6EEEC',
  fgMuted: '#8A9A9E',
  fgOnAccent: '#0B1214',
  borderSubtle: '#2A3A3E',
  borderFocus: '#2EC9C4',
  accentPrimary: '#2EC9C4',
  accentPrimaryHover: '#1AB3B0',
  statusTodo: '#8A9A9E',
  statusDoing: '#5BA3C4',
  statusDone: '#5CA872',
  statusOverdue: '#E07A86',
  statusDueSoon: '#E0A84A',
  reportDaily: '#2EC9C4',
  reportWeekly: '#5BA3C4',
  reportMonthly: '#E0A84A',
  reportYearly: '#A99BE0',
  danger: '#E07A86',
  scrim: 'rgb(0 0 0 / 58%)',
};

export const sharedTokens = {
  space: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
  },
  type: {
    caption: { fontSize: 12, lineHeight: 18 },
    meta: { fontSize: 13, lineHeight: 20 },
    body: { fontSize: 15, lineHeight: 24 },
    title: { fontSize: 20, lineHeight: 28 },
    display: { fontSize: 28, lineHeight: 36 },
  },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 },
  shadow: {
    light: '0 8px 24px rgb(14 26 36 / 8%)',
    dark: '0 12px 32px rgb(0 0 0 / 40%)',
  },
  z: { sticky: 10, dropdown: 40, overlay: 60, toast: 70, lightbox: 80 },
  motion: { outMs: 160, inMs: 120 },
  controlH: 40,
  controlHProminent: 44,
  fieldH: 44,
  hit: 44,
  focusRingW: 2,
  focusRingOffset: 2,
  fontFamily: {
    sans: "'Sora', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
    mono: 'ui-monospace, "IBM Plex Mono", monospace',
  },
} as const;

export type SharedTokens = typeof sharedTokens;

export type ThemeScheme = 'light' | 'dark';

export type Theme = ColorTokens & SharedTokens & { scheme: ThemeScheme };

export const themes: Record<ThemeScheme, Theme> = {
  light: { scheme: 'light', ...lightColors, ...sharedTokens },
  dark: { scheme: 'dark', ...darkColors, ...sharedTokens },
};
