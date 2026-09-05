import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { ThemePreference } from '@vital/dto';
import type { ThemeScheme } from '@vital/tokens';

export type ThemeChoice = ThemePreference;

export const THEME_CHOICE_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅' },
  { value: 'dark', label: '深' },
];

const THEME_KEY = 'vital.theme.choice';

let currentChoice: ThemeChoice = 'system';
const listeners = new Set<(choice: ThemeChoice) => void>();

export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

export function resolveThemeScheme(
  choice: ThemeChoice,
  system: ThemeScheme | null | undefined,
): ThemeScheme {
  if (choice === 'light' || choice === 'dark') return choice;
  return system === 'dark' ? 'dark' : 'light';
}

export function colorSchemeOverride(choice: ThemeChoice): ThemeScheme | null {
  return choice === 'system' ? null : choice;
}

export function getThemeChoice(): ThemeChoice {
  return currentChoice;
}

export function subscribeThemeChoice(fn: (choice: ThemeChoice) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(choice: ThemeChoice): void {
  currentChoice = choice;
  for (const fn of [...listeners]) fn(choice);
}

export function applyThemeChoice(choice: ThemeChoice): void {
  emit(choice);
  Appearance.setColorScheme(colorSchemeOverride(choice));
}

export function setThemeChoice(choice: ThemeChoice): void {
  applyThemeChoice(choice);
  void SecureStore.setItemAsync(THEME_KEY, choice).catch(() => undefined);
}

export async function hydrateThemeChoice(): Promise<void> {
  const raw = await SecureStore.getItemAsync(THEME_KEY).catch(() => null);
  applyThemeChoice(parseThemeChoice(raw));
}
