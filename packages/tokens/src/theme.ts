export interface ColorTokens {
  bgCanvas: string;
  bgSurface: string;
  bgSurfaceMuted: string;
  bgElevated: string;
  bgAccentSubtle: string;
  fgPrimary: string;
  fgMuted: string;
  textSecondary: string;
  textTertiary: string;
  fgOnAccent: string;
  borderSubtle: string;
  borderFocus: string;
  accentPrimary: string;
  accentPrimaryHover: string;
  accentDeep: string;
  focusRing: string;
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
  bgCanvas: '#F3F3ED',
  bgSurface: '#FAFAF6',
  bgSurfaceMuted: '#EAECE4',
  bgElevated: '#FFFFFF',
  bgAccentSubtle: '#DCE3D7',
  fgPrimary: '#272B27',
  fgMuted: '#697067',
  textSecondary: '#697067',
  textTertiary: '#969B91',
  fgOnAccent: '#FFFFFF',
  borderSubtle: '#DEE0D9',
  borderFocus: '#697C65',
  accentPrimary: '#697C65',
  accentPrimaryHover: '#425246',
  accentDeep: '#425246',
  focusRing: 'rgb(105 124 101 / 20%)',
  statusTodo: '#697067',
  statusDoing: '#4D82D8',
  statusDone: '#45A36B',
  statusOverdue: '#C95454',
  statusDueSoon: '#B97922',
  reportDaily: '#697C65',
  reportWeekly: '#697C65',
  reportMonthly: '#425246',
  reportYearly: '#425246',
  danger: '#C95454',
  scrim: 'rgb(39 43 39 / 28%)',
};

export const darkColors: ColorTokens = {
  bgCanvas: '#191C19',
  bgSurface: '#20231F',
  bgSurfaceMuted: '#292D27',
  bgElevated: '#30342F',
  bgAccentSubtle: '#303B2F',
  fgPrimary: '#EDEEE8',
  fgMuted: '#A8ADA3',
  textSecondary: '#A8ADA3',
  textTertiary: '#777D74',
  fgOnAccent: '#191C19',
  borderSubtle: '#393E37',
  borderFocus: '#A0B497',
  accentPrimary: '#A0B497',
  accentPrimaryHover: '#B7C8AF',
  accentDeep: '#A0B497',
  focusRing: 'rgb(160 180 151 / 24%)',
  statusTodo: '#A8ADA3',
  statusDoing: '#6FA0EE',
  statusDone: '#65C58A',
  statusOverdue: '#EB7777',
  statusDueSoon: '#E3AE55',
  reportDaily: '#A0B497',
  reportWeekly: '#A0B497',
  reportMonthly: '#B7C8AF',
  reportYearly: '#B7C8AF',
  danger: '#EB7777',
  scrim: 'rgb(0 0 0 / 48%)',
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
    meta: { fontSize: 13, lineHeight: 18 },
    body: { fontSize: 15, lineHeight: 22 },
    title: { fontSize: 24, lineHeight: 32 },
    display: { fontSize: 28, lineHeight: 36 },
  },
  radius: { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 },
  shadow: {
    light: '0 4px 16px rgb(39 43 39 / 6%)',
    dark: '0 12px 32px rgb(0 0 0 / 28%)',
  },
  z: { sticky: 10, dropdown: 40, overlay: 60, toast: 70, lightbox: 80 },
  motion: { outMs: 180, inMs: 120 },
  controlH: 36,
  controlHProminent: 40,
  fieldH: 40,
  hit: 44,
  focusRingW: 2,
  focusRingOffset: 2,
  fontFamily: {
    sans: "Inter, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
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
