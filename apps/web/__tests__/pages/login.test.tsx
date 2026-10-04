import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { LoginPage } from '@/pages/login';
import { setAuthForTest } from '@/services/auth.service';
import { RabRoot } from '../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      createQrLogin: vi.fn(),
      pollQrLogin: vi.fn(),
      login: vi.fn(),
    },
  };
});

const ticket = {
  id: '11111111-1111-4111-8111-111111111111',
  secret: 'a'.repeat(32),
  expiresAt: '2099-01-01T00:00:00.000Z',
};

const user: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  dailyModelCallLimit: 100,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: { dismissed: true },
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('LoginPage QR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuthForTest(null);
    if (typeof window.matchMedia !== 'function') {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({
          matches: false,
          media: '',
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      });
    }
    vi.mocked(client.createQrLogin).mockResolvedValue(ticket);
    vi.mocked(client.pollQrLogin).mockResolvedValue({ status: 'pending' });
  });

  it('shows a login QR and asks for a phone confirm after the scan', async () => {
    vi.mocked(client.pollQrLogin).mockResolvedValue({ status: 'scanned' });
    render(
      <RabRoot>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </RabRoot>,
    );
    expect(screen.getByRole('heading', { name: t.auth.loginTitle })).toBeInTheDocument();
    expect(await screen.findByText(t.auth.qrScanned)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: t.auth.qrTitle })).toBeInTheDocument();
    expect(client.createQrLogin).toHaveBeenCalled();
  });

  it('signs in when the phone confirms the QR', async () => {
    vi.mocked(client.pollQrLogin).mockResolvedValue({
      status: 'confirmed',
      user,
      tokens: { accessToken: 'web', expiresIn: 900 },
    });
    render(
      <RabRoot>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/today" element={<p>已登录</p>} />
          </Routes>
        </MemoryRouter>
      </RabRoot>,
    );
    expect(await screen.findByText('已登录')).toBeInTheDocument();
  });
});
