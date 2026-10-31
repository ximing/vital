import type { ExplorationProposal, ExplorationWindowDetail } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { ExploreWorkspace } from '../../../src/features/explore/ExploreWorkspace';
import { RabRoot } from '../../helpers/rab-root';
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type UserProfile,
} from '@vital/dto';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      getExplorationWindow: vi.fn(),
      restExplorationWindow: vi.fn(),
      selectExplorationProposal: vi.fn(),
      confirmExplorationProposal: vi.fn(),
      rejectExplorationProposal: vi.fn(),
    },
  };
});

const TZ = 'Asia/Shanghai';

const mockUser: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: TZ,
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  dailyModelCallLimit: 100,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: {},
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeProposal(over: Partial<ExplorationProposal> = {}): ExplorationProposal {
  return {
    id: 'p1',
    windowId: 'win-1',
    activityKey: 'neighborhood_stroll',
    status: 'proposed',
    interestReason: '从日常散步延伸一点。',
    content: {
      title: '熟悉街区慢走',
      reason: '从日常散步延伸一点。至少留出半天自由时间，不要把这段假期排满。',
      experience: '在住处附近慢慢走一圈。',
      timeCost: '约 1.5 小时',
      moneyRange: '免费',
      companions: '独自或家人',
      source: 'https://fixture.vital.test/activities',
      fetchedAt: '2026-09-21T04:00:00.000Z',
      cancelPolicy: '随时取消。',
      alternative: '下雨就改成室内。',
      direction: 'familiar',
      leaveFreeTime: '至少留出半天自由时间，不要把这段假期排满。',
    },
    planId: null,
    taskId: null,
    place: null,
    decisionDeadline: null,
    departureAt: null,
    nextVerifyAt: null,
    rejectedAt: null,
    version: 1,
    createdAt: '2026-09-21T04:00:00.000Z',
    verifications: [
      {
        id: 'v1',
        proposalId: 'p1',
        stage: 'initial',
        field: 'hours',
        value: null,
        url: 'https://fixture.vital.test/activities',
        fetchedAt: '2026-09-21T04:00:00.000Z',
        validUntil: null,
        status: 'verified',
        diff: null,
        createdAt: '2026-09-21T04:00:00.000Z',
      },
    ],
    ...over,
  };
}

function makeDetail(over: Partial<ExplorationWindowDetail> = {}): ExplorationWindowDetail {
  return {
    id: 'win-1',
    windowKey: 'holiday:CN:2026-10-01:2026-10-07',
    startDate: '2026-10-01',
    endDate: '2026-10-07',
    timezone: TZ,
    region: 'CN',
    calendarVersion: 'v1',
    status: 'open',
    closedReason: null,
    generatedAt: '2026-09-21T04:00:00.000Z',
    proposals: [makeProposal()],
    cityPrompt: '这次空闲会在哪座城市？',
    ...over,
  };
}

function renderExplore() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/explore/win-1']}>
          <Routes>
            <Route path="/explore/:windowId" element={<ExploreWorkspace />} />
            <Route path="/today" element={<div />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('explore workspace', () => {
  beforeEach(() => {
    setAuthForTest(mockUser);
    vi.mocked(client.getExplorationWindow).mockResolvedValue(makeDetail());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders proposals with reason, cost, source and rest', async () => {
    renderExplore();
    expect(await screen.findByRole('heading', { name: t.explore.title })).toBeInTheDocument();
    expect(document.querySelector('[data-region="explore-detail"]')).not.toBeNull();
    expect(screen.getByText('熟悉街区慢走')).toBeInTheDocument();
    expect(screen.getAllByText(/至少留出半天自由时间/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/https:\/\/fixture.vital.test\/activities/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: t.explore.select })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.explore.rest })).toBeInTheDocument();
  });

  it('hides empty copy when there are no proposals', async () => {
    vi.mocked(client.getExplorationWindow).mockResolvedValue(
      makeDetail({ proposals: [], cityPrompt: null }),
    );
    renderExplore();
    expect(await screen.findByText(t.explore.empty)).toBeInTheDocument();
  });

  it('shows confirm after a draft is ready', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getExplorationWindow).mockResolvedValue(
      makeDetail({ proposals: [makeProposal({ status: 'draft_ready' })] }),
    );
    vi.mocked(client.confirmExplorationProposal).mockResolvedValue(
      makeProposal({ status: 'confirmed', taskId: 'task-1' }),
    );
    renderExplore();
    await user.click(await screen.findByRole('button', { name: t.explore.confirm }));
    expect(client.confirmExplorationProposal).toHaveBeenCalledWith('p1', {});
  });
});
