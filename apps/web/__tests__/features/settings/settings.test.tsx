import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      testLlm: vi.fn(),
      listApiTokens: vi.fn(),
      createApiToken: vi.fn(),
      revokeApiToken: vi.fn(),
      listApiTokenAccess: vi.fn(),
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
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('NotificationsSection', () => {
  beforeEach(() => {
    setAuthForTest(mockUser);
    vi.mocked(client.listNotificationChannels).mockResolvedValue({ items: [] });
    vi.mocked(client.listApiTokens).mockResolvedValue({ items: [] });
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
    const canvas = document.querySelector('[data-region="settings-canvas"]');
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveClass('w-full');
    expect(screen.getByRole('heading', { name: t.settings.title }).parentElement).toHaveClass(
      'max-w-2xl',
      'mx-auto',
    );
    expect(screen.getByRole('button', { name: t.nav.logout })).toHaveClass('text-muted');
    expect(screen.getByLabelText(t.settings.displayName).closest('form')).toHaveClass('max-w-2xl');
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
    await user.click(screen.getByRole('tab', { name: t.settings.tabs.notifications }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.settings.notify.allDayTime })).toHaveClass(
        'h-[var(--field-h)]',
        'rounded-md',
      );
    });
    await user.click(screen.getByRole('tab', { name: t.settings.tabs.prefs }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.settings.timezone })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: t.settings.tabs.llm }));
    await waitFor(() => {
      expect(screen.getByLabelText(t.settings.llm.apiBase)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: t.settings.tabs.tokens }));
    await waitFor(() => {
      expect(screen.getByLabelText(t.settings.tokens.name)).toBeInTheDocument();
    });
  });

  it('saves OpenAI-compatible model settings', async () => {
    const user = userEvent.setup();
    vi.mocked(client.updateMe).mockResolvedValue({
      ...mockUser,
      llm: {
        apiBase: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4-flash',
        apiKeySet: true,
        parameters: { thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 4096 },
      },
    });
    render(
      <RabRoot>
        <MemoryRouter initialEntries={['/settings?tab=llm']}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </RabRoot>,
    );
    await user.type(
      screen.getByLabelText(t.settings.llm.apiBase),
      'https://open.bigmodel.cn/api/paas/v4',
    );
    await user.type(screen.getByLabelText(t.settings.llm.model), 'glm-4-flash');
    await user.type(screen.getByLabelText(t.settings.llm.apiKey), 'sk-test');
    fireEvent.change(screen.getByLabelText(t.settings.llm.parametersJson), {
      target: {
        value: '{"thinking":{"type":"enabled"},"reasoning_effort":"low","max_tokens":4096}',
      },
    });
    expect(screen.getByRole('button', { name: t.settings.llm.test })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: t.settings.llm.save }));
    await waitFor(() =>
      expect(client.updateMe).toHaveBeenCalledWith({
        llm: {
          apiBase: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4-flash',
          apiKey: 'sk-test',
          parameters: { thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 4096 },
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t.settings.llm.test })).toBeEnabled(),
    );
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
