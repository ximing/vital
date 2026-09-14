import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { HOME_PATH, t } from '@/copy';
import { LandingPage } from '@/pages/landing';
import { setAuthForTest } from '@/services/auth.service';
import { RabRoot } from '../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      getAppLatest: vi.fn(),
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
  onboarding: { dismissed: true },
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const latest = {
  versionName: '0.3.1',
  tag: 'v0.3.1',
  htmlUrl: 'https://github.com/ximing/vital/releases/tag/v0.3.1',
  publishedAt: '2026-09-14T00:00:00.000Z',
  android: {
    versionName: '0.3.1',
    versionCode: 301,
    apkUrl: 'https://github.com/ximing/vital/releases/download/v0.3.1/app-release.apk',
    sizeBytes: 73684571,
  },
  desktop: [
    {
      id: 'macos-arm' as const,
      url: 'https://github.com/ximing/vital/releases/download/v0.3.1/Vital_0.3.1_aarch64.dmg',
      name: 'Vital_0.3.1_aarch64.dmg',
      sizeBytes: 4458956,
    },
  ],
};

function mockMatchMedia(dark: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: dark && query.includes('prefers-color-scheme: dark'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function renderLanding() {
  return render(
    <RabRoot>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
        </Routes>
      </MemoryRouter>
    </RabRoot>,
  );
}

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchMedia(false);
    setAuthForTest(null);
    vi.mocked(client.getAppLatest).mockResolvedValue({ latest });
  });

  it('is readable without login and lists platform downloads', async () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: t.landing.hero })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: t.nav.login })[0]).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('link', { name: t.landing.start })[0]).toHaveAttribute('href', '/register');
    await waitFor(() => {
      expect(screen.getByText(t.landing.version.replace('{v}', '0.3.1'))).toBeInTheDocument();
    });
    const downloads = screen.getAllByRole('link', { name: t.landing.download });
    expect(downloads.map((el) => el.getAttribute('href'))).toEqual(
      expect.arrayContaining([latest.desktop[0]!.url, latest.android!.apkUrl]),
    );
    expect(screen.getByText(t.landing.android)).toBeInTheDocument();
  });

  it('sends a signed-in visitor into today instead of register', async () => {
    setAuthForTest(mockUser);
    renderLanding();
    const enter = screen.getAllByRole('link', { name: t.landing.enter });
    expect(enter[0]).toHaveAttribute('href', HOME_PATH);
    expect(screen.queryByRole('link', { name: t.nav.login })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(client.getAppLatest).toHaveBeenCalled();
    });
  });
});
