import type { VitalClient } from '../client.js';
import type { Http } from '../http.js';
import { isAuthResponse, tokensForStore } from '../http.js';
import { ApiError, type VitalClientOptions } from '../types.js';
import type { AuthResponse, QrLoginPollResponse } from '@vital/dto';

export function bindAuth(
  http: Http,
  options: VitalClientOptions,
  skipAuth: { method: 'POST'; skipAuth: true; skipAuthRefresh: true },
): Pick<
  VitalClient,
  | 'boot'
  | 'getAndroidRelease'
  | 'getAppLatest'
  | 'register'
  | 'login'
  | 'createExtensionAuthCode'
  | 'exchangeExtensionAuth'
  | 'createQrLogin'
  | 'pollQrLogin'
  | 'scanQrLogin'
  | 'confirmQrLogin'
  | 'cancelQrLogin'
  | 'refresh'
  | 'logout'
  | 'me'
  | 'updateMe'
  | 'updateOnboarding'
  | 'changePassword'
> {
  async function persistAuth(options: VitalClientOptions, data: unknown): Promise<AuthResponse> {
    if (!isAuthResponse(data)) {
      throw new ApiError(0, 'INVALID_RESPONSE', '响应格式错误');
    }
    const tokens = tokensForStore(options.authMode, data.tokens);
    await options.tokenStore.setTokens(tokens);
    return { user: data.user, tokens };
  }
  return {
    boot: () => http.boot(),
    getAndroidRelease: () =>
      http.request('/api/v1/app/android', { skipAuth: true, skipAuthRefresh: true }),
    getAppLatest: () => http.request('/api/v1/app', { skipAuth: true, skipAuthRefresh: true }),
    register: async (input) =>
      persistAuth(
        options,
        await http.request<unknown>('/api/v1/auth/register', { ...skipAuth, body: input }),
      ),
    login: async (input) =>
      persistAuth(
        options,
        await http.request<unknown>('/api/v1/auth/login', { ...skipAuth, body: input }),
      ),
    createExtensionAuthCode: () =>
      http.request('/api/v1/auth/extension/code', { method: 'POST', body: {} }),
    exchangeExtensionAuth: async (input) =>
      persistAuth(
        options,
        await http.request<unknown>('/api/v1/auth/extension/exchange', {
          ...skipAuth,
          body: input,
        }),
      ),
    createQrLogin: () =>
      http.request('/api/v1/auth/qr', {
        method: 'POST',
        skipAuth: true,
        skipAuthRefresh: true,
        body: {},
      }),
    pollQrLogin: async (input) => {
      const data: QrLoginPollResponse = await http.request('/api/v1/auth/qr/poll', {
        method: 'POST',
        skipAuth: true,
        skipAuthRefresh: true,
        body: input,
      });
      if (data.status === 'confirmed' && data.user && data.tokens) {
        await persistAuth(options, { user: data.user, tokens: data.tokens });
      }
      return data;
    },
    scanQrLogin: (input) => http.request('/api/v1/auth/qr/scan', { method: 'POST', body: input }),
    confirmQrLogin: (input) =>
      http.request('/api/v1/auth/qr/confirm', { method: 'POST', body: input }),
    cancelQrLogin: (input) =>
      http.request('/api/v1/auth/qr/cancel', { method: 'POST', body: input }),
    refresh: () => http.refresh(),
    logout: async () => {
      let body: { refreshToken?: string } = {};
      if (options.authMode === 'bearer') {
        const refreshToken = await options.tokenStore.getRefreshToken();
        if (refreshToken !== null && refreshToken !== '') {
          body = { refreshToken };
        }
      }
      try {
        await http.request('/api/v1/auth/logout', { ...skipAuth, body });
      } finally {
        try {
          await options.tokenStore.clear();
        } catch {
          // Local clear is best-effort after logout.
        }
      }
    },
    me: () => http.request('/api/v1/auth/me'),
    updateMe: (input) => http.request('/api/v1/auth/me', { method: 'PATCH', body: input }),
    updateOnboarding: (input) =>
      http.request('/api/v1/auth/onboarding', { method: 'PATCH', body: input }),
    changePassword: async (input) => {
      await http.request('/api/v1/auth/change-password', { method: 'POST', body: input });
      try {
        await options.tokenStore.clear();
      } catch {
        // Server already revoked every session.
      }
    },
  };
}
