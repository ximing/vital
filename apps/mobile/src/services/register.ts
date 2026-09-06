import { has, register } from '@rabjs/react';
import { AuthService } from './auth.service';
import { ThemeService } from './theme.service';

export function registerMobileServices(): void {
  if (!has(ThemeService)) register(ThemeService);
  if (!has(AuthService)) register(AuthService);
}
