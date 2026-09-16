import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { HOME_PATH } from '@/routes';
import { setAuthForTest } from '@/services/auth.service';
import { RootEntry } from '@/shell/require-auth';
import { RabRoot } from '../helpers/rab-root';

const baseUser: UserProfile = {
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

function renderRoot() {
  return render(
    <RabRoot>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RootEntry />} />
          <Route path="/login" element={<div>login-screen</div>} />
          <Route path={HOME_PATH} element={<div>today-screen</div>} />
          <Route path="/onboarding" element={<div>onboarding-screen</div>} />
        </Routes>
      </MemoryRouter>
    </RabRoot>,
  );
}

describe('RootEntry (desktop)', () => {
  beforeEach(() => {
    setAuthForTest(null);
  });

  it('sends a guest to login, not the marketing page', () => {
    renderRoot();
    expect(screen.getByText('login-screen')).toBeInTheDocument();
  });

  it('sends a signed-in user to today', () => {
    setAuthForTest(baseUser);
    renderRoot();
    expect(screen.getByText('today-screen')).toBeInTheDocument();
  });

  it('sends a new signed-in user to onboarding', () => {
    setAuthForTest({ ...baseUser, onboarding: {} });
    renderRoot();
    expect(screen.getByText('onboarding-screen')).toBeInTheDocument();
  });
});
