import { DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useAuthStore } from '@/state/auth-store';
import { ActivationChecklist } from '../../../src/features/onboarding/ActivationChecklist';
import { needsOnboarding, showChecklist } from '../../../src/features/onboarding/model';
import { OnboardingPage } from '../../../src/features/onboarding/OnboardingPage';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      updateOnboarding: vi.fn(),
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

function renderOnboarding() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('onboarding', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: mockUser, status: 'ready' });
    vi.mocked(client.updateOnboarding).mockResolvedValue({
      ...mockUser,
      onboarding: { dismissed: true },
    });
  });

  it('needs wizard until a checklist flag or skip', () => {
    expect(needsOnboarding(mockUser)).toBe(true);
    expect(needsOnboarding({ ...mockUser, onboarding: { dismissed: true } })).toBe(false);
    expect(needsOnboarding({ ...mockUser, onboarding: { createdTask: true } })).toBe(false);
    expect(showChecklist({ createdTask: true })).toBe(true);
    expect(showChecklist({ dismissed: true, createdTask: true })).toBe(false);
  });

  it('has three skippable steps and skip sets dismissed', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    expect(screen.getByRole('heading', { name: t.onboarding.steps[0]?.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.onboarding.next }));
    expect(screen.getByRole('heading', { name: t.onboarding.steps[1]?.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.onboarding.next }));
    expect(screen.getByRole('heading', { name: t.onboarding.steps[2]?.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.onboarding.skipAll }));
    expect(client.updateOnboarding).toHaveBeenCalledWith({ dismissed: true });
  });

  it('renders the five-item activation checklist', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ user: mockUser, status: 'ready' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ActivationChecklist />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(t.checklist.items.createdTask)).toBeInTheDocument();
    expect(screen.getByText(t.checklist.items.completedTask)).toBeInTheDocument();
    expect(screen.getByText(t.checklist.items.capturedInbox)).toBeInTheDocument();
    expect(screen.getByText(t.checklist.items.openedWeekly)).toBeInTheDocument();
    expect(screen.getByText(t.checklist.items.pinnedTask)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.checklist.dismiss }));
    expect(client.updateOnboarding).toHaveBeenCalledWith({ dismissed: true });
  });
});
