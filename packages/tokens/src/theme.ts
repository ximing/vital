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
  bgCanvas: '#FFFBF5',
  bgSurface: '#FFFFFF',
  bgSurfaceMuted: '#F3EBDC',
  bgAccentSubtle: '#FFE7A3',
  fgPrimary: '#1C1914',
  fgMuted: '#6E665B',
  fgOnAccent: '#1C1914',
  borderSubtle: '#EDE3D0',
  borderFocus: '#E8A317',
  accentPrimary: '#E8A317',
  accentPrimaryHover: '#C48A00',
  statusTodo: '#6E665B',
  statusDoing: '#2F8FCB',
  statusDone: '#2F9E5A',
  statusOverdue: '#E25B4A',
  statusDueSoon: '#E8A317',
  reportDaily: '#E8A317',
  reportWeekly: '#2F8FCB',
  reportMonthly: '#E59A12',
  reportYearly: '#7C6BC4',
  danger: '#E25B4A',
  scrim: 'rgb(28 25 20 / 40%)',
};

export const darkColors: ColorTokens = {
  bgCanvas: '#14110C',
  bgSurface: '#1F1B16',
  bgSurfaceMuted: '#2C261E',
  bgAccentSubtle: '#3D3014',
  fgPrimary: '#F8F1E4',
  fgMuted: '#B5A894',
  fgOnAccent: '#1C1914',
  borderSubtle: '#3A3328',
  borderFocus: '#F5C84B',
  accentPrimary: '#F5C84B',
  accentPrimaryHover: '#E8A317',
  statusTodo: '#B5A894',
  statusDoing: '#6EB3E0',
  statusDone: '#5CBA78',
  statusOverdue: '#F07A6A',
  statusDueSoon: '#F5C84B',
  reportDaily: '#F5C84B',
  reportWeekly: '#6EB3E0',
  reportMonthly: '#F0B429',
  reportYearly: '#B5A4EF',
  danger: '#F07A6A',
  scrim: 'rgb(0 0 0 / 55%)',
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
    light: '0 8px 28px rgb(28 25 20 / 7%)',
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
