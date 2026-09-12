import { ApiError } from '@vital/api-client';
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type UserProfile,
} from '@vital/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CLEARED_EVENT, client } from '@/api/client';
import { authService } from '@/services/auth.service';
import { registerVitalServices } from '@/services/register';
import { RabRoot } from '../helpers/rab-root';
import { render } from '@testing-library/react';

const mockUser: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: {},
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function mountAuth(): ReturnType<typeof authService> {
  render(
    <RabRoot>
      <span />
    </RabRoot>,
  );
  registerVitalServices();
  const auth = authService();
  auth.reset(null, 'booting');
  return auth;
}

describe('AuthService boot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('treats an explicit invalid session as logged out', async () => {
    const auth = mountAuth();
    vi.spyOn(client, 'boot').mockResolvedValue('guest');
    await auth.boot();
    expect(auth.user).toBeNull();
    expect(auth.status).toBe('ready');
  });

  it('does not log out when the session cannot be reached', async () => {
    const auth = mountAuth();
    vi.spyOn(client, 'boot').mockResolvedValue('unreachable');
    await auth.boot();
    expect(auth.user).toBeNull();
    expect(auth.status).toBe('unavailable');
  });

  it('does not log out when /me fails with a server error', async () => {
    const auth = mountAuth();
    vi.spyOn(client, 'boot').mockResolvedValue('ok');
    vi.spyOn(client, 'me').mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', '暂时不可用'),
    );
    await auth.boot();
    expect(auth.user).toBeNull();
    expect(auth.status).toBe('unavailable');
  });

  it('logs out when /me returns INVALID_TOKEN', async () => {
    const auth = mountAuth();
    vi.spyOn(client, 'boot').mockResolvedValue('ok');
    vi.spyOn(client, 'me').mockRejectedValue(
      new ApiError(401, 'INVALID_TOKEN', '登录已过期'),
    );
    await auth.boot();
    expect(auth.user).toBeNull();
    expect(auth.status).toBe('ready');
  });

  it('AUTH_CLEARED marks the session as logged out', () => {
    const auth = mountAuth();
    auth.reset(mockUser, 'unavailable');
    window.dispatchEvent(new Event(AUTH_CLEARED_EVENT));
    expect(auth.user).toBeNull();
    expect(auth.status).toBe('ready');
  });
});
