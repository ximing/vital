import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { HOME_PATH, t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { themeService } from '@/services/theme.service';
import { Shell } from '../../src/shell/Shell';
import { RabRoot } from '../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listLists: vi.fn(),
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

function renderShell(path = '/search') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="*" element={<div />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('primary rail', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(false);
    themeService().reset();
    setAuthForTest(mockUser);
    vi.mocked(client.listLists).mockResolvedValue({ items: [] });
    vi.mocked(client.updateMe).mockResolvedValue(mockUser);
  });

  afterEach(() => {
    localStorage.clear();
    themeService().reset();
    document.documentElement.removeAttribute('data-theme');
  });

  it('puts search in the primary nav after reflect', () => {
    renderShell();
    const rail = screen.getByLabelText('主导航');
    const hrefs = within(rail)
      .getByRole('navigation')
      .querySelectorAll('a');
    expect([...hrefs].map((el) => el.getAttribute('href'))).toEqual([
      HOME_PATH,
      '/inbox',
      '/reports',
      '/search',
    ]);
  });

  it('groups theme, settings, and avatar at the bottom of the rail', () => {
    renderShell();
    const group = document.querySelector('[data-region="rail-account"]');
    expect(group).not.toBeNull();
    expect(group).toHaveClass('gap-1');
    const kids = [...(group as HTMLElement).children];
    expect(kids[0]).toHaveAttribute('aria-label', t.theme.switch);
    expect(kids[1]).toHaveAttribute('href', '/settings');
    const avatar = kids[2]?.querySelector('[aria-haspopup="menu"]');
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveClass('w-full', 'justify-center');
  });

  it('renders the saved avatar photo in the rail', () => {
    setAuthForTest({
      ...mockUser,
      avatarUrl: 'https://cdn.example/me.png',
    });
    renderShell();
    const group = document.querySelector('[data-region="rail-account"]') as HTMLElement;
    const img = group.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://cdn.example/me.png');
    expect(screen.getByRole('button', { name: '测试' })).toBeInTheDocument();
  });

  it('updates the rail photo after the avatar is saved', async () => {
    renderShell();
    expect(document.querySelector('[data-region="rail-account"] img')).toBeNull();
    setAuthForTest({
      ...mockUser,
      avatarUrl: 'https://cdn.example/me.png',
    });
    await waitFor(() => {
      expect(document.querySelector('[data-region="rail-account"] img')).toHaveAttribute(
        'src',
        'https://cdn.example/me.png',
      );
    });
  });

  it('toggles theme from the rail back and forth', async () => {
    const user = userEvent.setup();
    themeService().setChoice('light');
    renderShell();
    const toggle = within(document.querySelector('[data-region="rail-account"]') as HTMLElement).getByRole(
      'switch',
      { name: t.theme.switch },
    );
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the avatar account menu with settings, theme, and logout', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: '测试' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: t.nav.settings })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(within(menu).getByRole('switch', { name: t.theme.switch })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: t.nav.logout })).toBeInTheDocument();
  });
});
