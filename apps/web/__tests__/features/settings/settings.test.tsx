import { DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { NotificationsSection } from '../../../src/features/settings/NotificationsSection';
import { useAuthStore } from '@/state/auth-store';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listNotificationChannels: vi.fn(),
      createNotificationChannel: vi.fn(),
      patchNotificationChannel: vi.fn(),
      testNotificationChannel: vi.fn(),
      updateMe: vi.fn(),
    },
  };
});

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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('NotificationsSection', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: mockUser, status: 'ready' });
    vi.mocked(client.listNotificationChannels).mockResolvedValue({ items: [] });
    vi.mocked(client.createNotificationChannel).mockResolvedValue({
      id: 'c1',
      type: 'meow',
      enabled: true,
      config: { nickname: 'Ada' },
      lastSuccessAt: null,
      lastError: null,
      createdAt: mockUser.createdAt,
      updatedAt: mockUser.updatedAt,
    });
  });

  it('saves a MeoW nickname', async () => {
    const user = userEvent.setup();
    render(<NotificationsSection />);
    await waitFor(() => expect(client.listNotificationChannels).toHaveBeenCalled());
    await user.type(screen.getByLabelText(t.settings.notify.nickname), 'Ada');
    await user.click(screen.getByRole('button', { name: t.settings.notify.saveChannel }));
    await waitFor(() =>
      expect(client.createNotificationChannel).toHaveBeenCalledWith({
        type: 'meow',
        enabled: true,
        config: { nickname: 'Ada' },
      }),
    );
  });
});
