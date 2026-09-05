import { useColorScheme } from 'react-native';
import { themes, type Theme } from '@vital/tokens';

/**
 * 主题 = 系统外观的纯函数：跟随 Appearance，无 Provider。
 * persist 走 preference.ts → Appearance.setColorScheme。
 */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? themes.dark : themes.light;
}
