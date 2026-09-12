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
  statusFavorite: string;
  reportDaily: string;
  reportWeekly: string;
  reportMonthly: string;
  reportYearly: string;
  danger: string;
  scrim: string;
  srcExtension: string;
  srcWechat: string;
  srcWeb: string;
  srcMobile: string;
  srcManual: string;
}

export const lightColors: ColorTokens = {
  bgCanvas: '#F3F5F2',
  bgSurface: '#FAFBF9',
  bgSurfaceMuted: '#EBEEE9',
  bgElevated: '#FFFFFF',
  bgAccentSubtle: '#DFEDE4',
  fgPrimary: '#1B211D',
  fgMuted: '#555E56',
  textSecondary: '#555E56',
  textTertiary: '#98A098',
  fgOnAccent: '#FFFFFF',
  borderSubtle: '#E2E6E0',
  borderFocus: '#1C7A4F',
  accentPrimary: '#1C7A4F',
  accentPrimaryHover: '#155E3D',
  accentDeep: '#155E3D',
  focusRing: 'rgb(28 122 79 / 16%)',
  statusTodo: '#555E56',
  statusDoing: '#3D6FD1',
  statusDone: '#2F9E63',
  statusOverdue: '#CE4A45',
  statusDueSoon: '#B4761E',
  statusFavorite: '#D9A62E',
  reportDaily: '#1C7A4F',
  reportWeekly: '#1C7A4F',
  reportMonthly: '#155E3D',
  reportYearly: '#155E3D',
  danger: '#CE4A45',
  scrim: 'rgb(27 33 29 / 32%)',
  srcExtension: '#6A5CD0',
  srcWechat: '#229E4E',
  srcWeb: '#3D6FD1',
  srcMobile: '#B4761E',
  srcManual: '#2C9C8C',
};

export const darkColors: ColorTokens = {
  bgCanvas: '#0F1210',
  bgSurface: '#161A17',
  bgSurfaceMuted: '#1D221E',
  bgElevated: '#232925',
  bgAccentSubtle: '#1B2E24',
  fgPrimary: '#ECEFEB',
  fgMuted: '#A4ACA1',
  textSecondary: '#A4ACA1',
  textTertiary: '#798174',
  fgOnAccent: '#0B1611',
  borderSubtle: 'rgba(255, 255, 255, 0.08)',
  borderFocus: '#5FD3A1',
  accentPrimary: '#5FD3A1',
  accentPrimaryHover: '#82E0B6',
  accentDeep: '#5FD3A1',
  focusRing: 'rgb(95 211 161 / 22%)',
  statusTodo: '#A4ACA1',
  statusDoing: '#6FA0EE',
  statusDone: '#63C78D',
  statusOverdue: '#E8756C',
  statusDueSoon: '#E0A94E',
  statusFavorite: '#F2CC6B',
  reportDaily: '#5FD3A1',
  reportWeekly: '#5FD3A1',
  reportMonthly: '#82E0B6',
  reportYearly: '#82E0B6',
  danger: '#E8756C',
  scrim: 'rgba(0, 0, 0, 0.52)',
  srcExtension: '#9D8EF0',
  srcWechat: '#5CCF82',
  srcWeb: '#7FA8F0',
  srcMobile: '#E0A94E',
  srcManual: '#5CC9B8',
};

export const sharedTokens = {
  space: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    10: 40,
    12: 48,
    14: 56,
  },
  type: {
    caption: { fontSize: 12, lineHeight: 16 },
    meta: { fontSize: 13, lineHeight: 18 },
    body: { fontSize: 14, lineHeight: 21 },
    section: { fontSize: 16, lineHeight: 24 },
    title: { fontSize: 20, lineHeight: 28 },
    display: { fontSize: 26, lineHeight: 34 },
  },
  radius: { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 },
  shadow: {
    light: '0 1px 2px rgb(20 34 24 / 5%), 0 10px 28px rgb(20 34 24 / 7%)',
    dark: '0 1px 2px rgb(0 0 0 / 30%), 0 12px 32px rgb(0 0 0 / 42%)',
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
    display: "Sora, Inter, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
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
