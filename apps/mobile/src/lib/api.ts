import Constants from 'expo-constants';
import { createVitalClient, type VitalClient } from '@vital/api-client';
import { secureTokenStore } from './token-store';

function extraApiUrl(extra: unknown): string | undefined {
  if (typeof extra !== 'object' || extra === null) return undefined;
  if (!('apiUrl' in extra)) return undefined;
  return typeof extra.apiUrl === 'string' ? extra.apiUrl : undefined;
}

export const apiUrl = extraApiUrl(Constants.expoConfig?.extra) ?? 'http://localhost:3010';

export const client: VitalClient = createVitalClient({
  baseUrl: apiUrl,
  tokenStore: secureTokenStore,
  authMode: 'bearer',
});
