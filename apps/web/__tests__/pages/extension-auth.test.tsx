import { DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { ExtensionAuthPage } from '@/pages/extension-auth';
import { RabRoot } from '../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      createExtensionAuthCode: vi.fn(),
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

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('ExtensionAuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuthForTest(mockUser);
    vi.mocked(client.createExtensionAuthCode).mockResolvedValue({
      code: 'c'.repeat(32),
      expiresIn: 120,
    });
  });

  it('issues a code and hands it to the extension', async () => {
    const sendMessage = vi.fn((_id: string, _msg: unknown, cb?: (res: unknown) => void) => {
      cb?.({ ok: true });
    });
    Object.assign(window, { chrome: { runtime: { sendMessage } } });

    render(
      <RabRoot>
        <MemoryRouter initialEntries={[`/auth/extension?id=${EXT_ID}`]}>
          <Routes>
            <Route path="/auth/extension" element={<ExtensionAuthPage />} />
          </Routes>
        </MemoryRouter>
      </RabRoot>,
    );

    expect(screen.getByRole('heading', { name: t.auth.extensionTitle })).toBeInTheDocument();
    await waitFor(() => {
      expect(client.createExtensionAuthCode).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        EXT_ID,
        { type: 'vital-extension-auth', code: 'c'.repeat(32) },
        expect.any(Function),
      );
    });
    expect(await screen.findByText(t.auth.extensionConnected)).toBeInTheDocument();
  });

  it('rejects a missing extension id', () => {
    render(
      <RabRoot>
        <MemoryRouter initialEntries={['/auth/extension']}>
          <Routes>
            <Route path="/auth/extension" element={<ExtensionAuthPage />} />
          </Routes>
        </MemoryRouter>
      </RabRoot>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(t.auth.extensionMissingId);
    expect(client.createExtensionAuthCode).not.toHaveBeenCalled();
  });
});
