import type {
  AuthMode,
  AuthResponse,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateMeInput,
  UpdateOnboardingInput,
  UploadCompleteResponse,
  UploadPresignInput,
  UploadPresignResponse,
  UserProfile,
} from '@vital/dto';
import { Http, isAuthResponse } from './http.js';
import { ApiError, type VitalClientOptions } from './types.js';
import { uploadImpl, type UploadInput } from './upload.js';

export interface VitalClient {
  readonly authMode: AuthMode;
  boot(): Promise<boolean>;
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
  refresh(): Promise<AuthResponse>;
  logout(): Promise<void>;
  me(): Promise<UserProfile>;
  updateMe(input: UpdateMeInput): Promise<UserProfile>;
  updateOnboarding(input: UpdateOnboardingInput): Promise<UserProfile>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  presignUpload(input: UploadPresignInput): Promise<UploadPresignResponse>;
  completeUpload(id: string): Promise<UploadCompleteResponse>;
  abortUpload(id: string): Promise<void>;
  discardUpload(id: string): Promise<void>;
  uploadUrl(id: string): string;
  fetchUploadBlob(id: string): Promise<Blob>;
  upload(input: UploadInput): Promise<UploadCompleteResponse>;
}

async function persistAuth(
  store: VitalClientOptions['tokenStore'],
  data: unknown,
): Promise<AuthResponse> {
  if (!isAuthResponse(data)) {
    throw new ApiError(0, 'INVALID_RESPONSE', '响应格式错误');
  }
  await store.setTokens(data.tokens);
  return data;
}

export function createVitalClient(options: VitalClientOptions): VitalClient {
  const http = new Http(options);
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const skipAuth: { method: 'POST'; skipAuth: true; skipAuthRefresh: true } = {
    method: 'POST',
    skipAuth: true,
    skipAuthRefresh: true,
  };

  return {
    authMode: options.authMode,
    boot: () => http.boot(),
    register: async (input) =>
      persistAuth(
        options.tokenStore,
        await http.request<unknown>('/api/v1/auth/register', { ...skipAuth, body: input }),
      ),
    login: async (input) =>
      persistAuth(
        options.tokenStore,
        await http.request<unknown>('/api/v1/auth/login', { ...skipAuth, body: input }),
      ),
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
    presignUpload: (input) =>
      http.request('/api/v1/uploads/presign', { method: 'POST', body: input }),
    completeUpload: (id) =>
      http.request(`/api/v1/uploads/${id}/complete`, { method: 'POST', body: {} }),
    abortUpload: (id) => http.request(`/api/v1/uploads/${id}/abort`, { method: 'POST' }),
    discardUpload: (id) => http.request(`/api/v1/uploads/${id}`, { method: 'DELETE' }),
    uploadUrl: (id) => `${baseUrl}/api/v1/uploads/${id}`,
    fetchUploadBlob: (id) => http.requestBlob(`/api/v1/uploads/${id}`),
    upload: (input) => uploadImpl(http, options, input),
  };
}
