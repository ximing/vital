import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { SecondaryPane } from '../../src/shell/SecondaryPane';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      getReportCounts: vi.fn(),
    },
  };
});

function renderPane(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <SecondaryPane section="reflect" width={260} onResize={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('secondary pane reflect nav', () => {
  beforeEach(() => {
    vi.mocked(client.getReportCounts).mockResolvedValue({
      daily: 12,
      weekly: 3,
      monthly: 0,
      yearly: 120,
    });
  });

  it('shows per-type report counts, capping at 99+ and hiding zero', async () => {
    renderPane('/reports');
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('99+')).toBeInTheDocument();
    const monthly = screen.getByText(t.reports.monthly).closest('a');
    expect(monthly?.textContent).toBe(t.reports.monthly);
  });
});
