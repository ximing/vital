import type { AgentUsageSummary } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { SettingsPage } from '../../../src/pages/settings';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      getAgentUsage: vi.fn(),
    },
  };
});

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

const summary: AgentUsageSummary = {
  days: 30,
  totalRuns: 3,
  totalPromptTokens: 68_200,
  totalCompletionTokens: 9_100,
  totalCostMicros: 31_000,
  items: [
    {
      date: '2026-09-09',
      capability: 'headline',
      runs: 2,
      promptTokens: 41_000,
      completionTokens: 5_400,
      costMicros: 19_000,
    },
    {
      date: '2026-09-09',
      capability: 'cluster',
      runs: 1,
      promptTokens: 18_600,
      completionTokens: 2_200,
      costMicros: 8_000,
    },
    {
      date: '2026-09-08',
      capability: 'decompose',
      runs: 1,
      promptTokens: 8_600,
      completionTokens: 1_500,
      costMicros: 4_000,
    },
  ],
};

describe('settings usage tab', () => {
  beforeEach(() => {
    vi.mocked(client.getAgentUsage).mockResolvedValue(summary);
  });

  it('guards unknown tab values back to account', () => {
    renderAt('/settings?tab=bogus');
    expect(screen.getByRole('tab', { name: t.settings.tabs.account })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: t.settings.tabs.usage })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('renders the day × capability table with totals', async () => {
    renderAt('/settings?tab=usage');
    expect(screen.getByRole('tab', { name: t.settings.tabs.usage })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await waitFor(() => {
      expect(screen.getByText(t.settings.usage.capabilities.headline)).toBeInTheDocument();
    });
    expect(client.getAgentUsage).toHaveBeenCalledWith(30);

    // Capability labels and formatted numbers.
    expect(screen.getByText(t.settings.usage.capabilities.cluster)).toBeInTheDocument();
    expect(screen.getByText(t.settings.usage.capabilities.decompose)).toBeInTheDocument();
    expect(screen.getByText('41.0k')).toBeInTheDocument();
    expect(screen.getByText('$0.019')).toBeInTheDocument();

    // Summary strip: combined tokens, cost at 2 digits, run count.
    expect(screen.getByText('77.3k')).toBeInTheDocument();
    expect(screen.getByText('$0.03')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // 30-day total row sums every day.
    const totalRow = document.querySelector('[data-usage-row="total"]');
    expect(totalRow).not.toBeNull();
    expect(totalRow).toHaveTextContent(t.settings.usage.monthTotal);
    expect(totalRow).toHaveTextContent('68.2k');
    expect(totalRow).toHaveTextContent('9.1k');
    expect(totalRow).toHaveTextContent('$0.031');

    // One row per day plus one per capability entry.
    expect(document.querySelectorAll('[data-usage-row="day"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-usage-row="capability"]')).toHaveLength(3);
  });

  it('shows a friendly empty state when nothing was recorded', async () => {
    vi.mocked(client.getAgentUsage).mockResolvedValue({
      days: 30,
      totalRuns: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCostMicros: 0,
      items: [],
    });
    renderAt('/settings?tab=usage');
    await waitFor(() => {
      expect(screen.getByText(t.settings.usage.empty)).toBeInTheDocument();
    });
    expect(document.querySelector('[data-region="usage-table"]')).toBeNull();
  });
});
