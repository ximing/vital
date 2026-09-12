import type { ViewStyle } from 'react-native';
import type { Theme } from '@vital/tokens';

export function cardStyle(t: Theme): ViewStyle {
  return {
    borderRadius: t.radius.lg,
    backgroundColor: t.bgSurface,
    borderWidth: 1,
    borderColor: t.borderSubtle,
    overflow: 'hidden',
  };
}

export function rnShadow(t: Theme): ViewStyle {
  return {
    shadowColor: t.fgPrimary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: t.scheme === 'dark' ? 0.3 : 0.08,
    shadowRadius: t.scheme === 'dark' ? 12 : 8,
    elevation: 2,
  };
}
