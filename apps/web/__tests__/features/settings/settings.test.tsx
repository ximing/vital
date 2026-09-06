import { DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { NotificationsSection } from '../../../src/features/settings/NotificationsSection';
import { SettingsPage } from '../../../src/pages/settings';
import { setAuthForTest } from '@/services/auth.service';
import { RabRoot } from '../../helpers/rab-root';

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
    setAuthForTest(mockUser);
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

  it('switches settings tabs', async () => {
    const user = userEvent.setup();
    render(
      <RabRoot>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </RabRoot>,
    );
    const canvas = screen.getByRole('heading', { name: t.settings.title }).parentElement;
    expect(canvas).toHaveAttribute('data-region', 'settings-canvas');
    expect(canvas).toHaveClass('w-full', 'max-w-5xl');
    expect(screen.getByRole('button', { name: t.nav.logout })).toHaveClass('border', 'text-danger');
    expect(screen.getByLabelText(t.settings.displayName).closest('form')).toHaveClass('max-w-xl');
    expect(screen.getByRole('tab', { name: t.settings.tabs.account })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: t.settings.tabs.appearance }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: t.settings.tabs.appearance })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(screen.getByRole('radiogroup', { name: t.theme.label })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: t.settings.tabs.prefs }));
    await waitFor(() => {
      expect(screen.getByLabelText(t.settings.timezone)).toBeInTheDocument();
    });
  });

  it('saves a MeoW nickname', async () => {
    const user = userEvent.setup();
    render(
      <RabRoot>
        <NotificationsSection />
      </RabRoot>,
    );
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
