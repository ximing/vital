import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { SettingsPage } from '../../../src/pages/settings';
import { setAuthForTest } from '@/services/auth.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listNotificationChannels: vi.fn(),
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

describe('TokensSection', () => {
  beforeEach(() => {
    setAuthForTest(mockUser);
    vi.mocked(client.listApiTokens).mockResolvedValue({ items: [] });
    vi.mocked(client.listApiTokenAccess).mockResolvedValue({ items: [], nextCursor: null });
  });

  it('creates a token, shows the secret once, and revokes it', async () => {
    const user = userEvent.setup();
    vi.mocked(client.createApiToken).mockResolvedValue({
      id: 'tok1',
      name: 'Claude',
      tokenPrefix: 'vt_abcdefghi',
      token: 'vt_secret_once',
      lastUsedAt: null,
      createdAt: mockUser.createdAt,
    });
    vi.mocked(client.listApiTokens)
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({
        items: [
          {
            id: 'tok1',
            name: 'Claude',
            tokenPrefix: 'vt_abcdefghi',
            lastUsedAt: null,
            createdAt: mockUser.createdAt,
          },
        ],
      });
    vi.mocked(client.revokeApiToken).mockResolvedValue(undefined);

    render(
      <RabRoot>
        <MemoryRouter initialEntries={['/settings?tab=tokens']}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </RabRoot>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: t.settings.tabs.tokens })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    await user.type(screen.getByLabelText(t.settings.tokens.name), 'Claude');
    await user.click(screen.getByRole('button', { name: t.settings.tokens.create }));
    await waitFor(() => {
      expect(screen.getByText('vt_secret_once')).toBeInTheDocument();
    });
    expect(screen.getByText(t.settings.tokens.created)).toBeInTheDocument();
    expect(client.createApiToken).toHaveBeenCalledWith({ name: 'Claude' });

    await user.click(screen.getByRole('button', { name: t.settings.tokens.revoke }));
    await user.click(screen.getByRole('button', { name: t.settings.tokens.confirmRevoke }));
    await waitFor(() => {
      expect(client.revokeApiToken).toHaveBeenCalledWith('tok1');
    });
  });
});
