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
      llmCatalog: vi.fn(),
      addLlmProvider: vi.fn(),
      patchLlmProvider: vi.fn(),
      putLlmRouting: vi.fn(),
      testLlmProvider: vi.fn(),
      removeLlmProvider: vi.fn(),
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
    vi.mocked(client.llmCatalog).mockResolvedValue({
      providers: [
        { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5-mini', name: 'gpt-5-mini' }] },
      ],
    });
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
    expect(screen.getByRole('tablist', { name: t.settings.title })).toHaveAttribute(
      'aria-orientation',
      'vertical',
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
      expect(screen.getByRole('heading', { name: t.settings.llm.providers })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: t.settings.tabs.tokens }));
    await waitFor(() => {
      expect(screen.getByLabelText(t.settings.tokens.name)).toBeInTheDocument();
    });
  });

  it('adds a custom OpenAI-compatible provider', async () => {
    const user = userEvent.setup();
    vi.mocked(client.addLlmProvider).mockResolvedValue({
      providers: [
        {
          id: 'prov-1',
          providerId: 'custom',
          label: '公司网关',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          models: ['glm-4-flash'],
          apiKeySet: true,
        },
      ],
      routing: {},
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

    await user.click(screen.getByRole('button', { name: `＋ ${t.settings.llm.addProvider}` }));
    // Switch the provider picker to a custom endpoint.
    await user.click(screen.getByRole('button', { name: t.settings.llm.addProvider }));
    await user.click(screen.getByRole('option', { name: t.settings.llm.customEndpoint }));
    await user.type(screen.getByLabelText(t.settings.llm.providerLabel), '公司网关');
    await user.type(
      screen.getByLabelText(t.settings.llm.apiBase),
      'https://open.bigmodel.cn/api/paas/v4',
    );
    await user.type(screen.getByLabelText(t.settings.llm.providerModels), 'glm-4-flash{Enter}');
    await user.type(screen.getByLabelText(t.settings.llm.apiKey), 'sk-test');
    await user.click(screen.getByRole('button', { name: t.settings.llm.add }));

    await waitFor(() =>
      expect(client.addLlmProvider).toHaveBeenCalledWith({
        providerId: 'custom',
        label: '公司网关',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'sk-test',
        models: ['glm-4-flash'],
      }),
    );
    expect(await screen.findByText('公司网关')).toBeInTheDocument();
    expect(screen.getByText('已配置密钥')).toBeInTheDocument();
  });

  it('edits saved model parameters independently and restores them on remount', async () => {
    const user = userEvent.setup();
    const provider = {
      id: 'p1',
      providerId: 'custom',
      label: '参数测试',
      baseUrl: 'https://example.com/v1',
      models: ['model-a', 'model-b'],
      apiKeySet: true,
      modelParameters: { 'model-a': { reasoning_effort: 'low' }, 'model-b': { temperature: 0.3 } },
    };
    setAuthForTest({ ...mockUser, llm: { providers: [provider], routing: {} } });
    vi.mocked(client.patchLlmProvider).mockImplementation(async (_id, input) => ({
      providers: [{ ...provider, modelParameters: input.modelParameters ?? {} }],
      routing: {},
    }));
    const renderPage = () =>
      render(
        <RabRoot>
          <MemoryRouter initialEntries={['/settings?tab=llm']}>
            <Routes>
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </MemoryRouter>
        </RabRoot>,
      );
    const view = renderPage();
    await user.click(screen.getByText('配置模型参数 · 参数测试'));
    fireEvent.change(screen.getByLabelText('model-a 参数 JSON'), {
      target: { value: '{"thinking":{"type":"enabled"},"reasoning_effort":"high","top_k":20}' },
    });
    expect(screen.getByRole('button', { name: '测试 model-a' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '保存模型参数' }));
    await waitFor(() =>
      expect(client.patchLlmProvider).toHaveBeenCalledWith('p1', {
        modelParameters: {
          'model-a': { thinking: { type: 'enabled' }, reasoning_effort: 'high', top_k: 20 },
          'model-b': { temperature: 0.3 },
        },
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '测试 model-a' })).toBeEnabled());
    view.unmount();
    renderPage();
    await user.click(screen.getByText('配置模型参数 · 参数测试'));
    expect(
      JSON.parse((screen.getByLabelText('model-a 参数 JSON') as HTMLTextAreaElement).value),
    ).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      top_k: 20,
    });
    expect(
      JSON.parse((screen.getByLabelText('model-b 参数 JSON') as HTMLTextAreaElement).value),
    ).toEqual({ temperature: 0.3 });
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
