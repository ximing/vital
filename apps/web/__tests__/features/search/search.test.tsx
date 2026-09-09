import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { SearchPage } from '../../../src/features/search/SearchPage';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      search: vi.fn(),
    },
  };
});

describe('search page', () => {
  beforeEach(() => {
    vi.mocked(client.search).mockResolvedValue({
      items: [
        {
          type: 'inbox',
          inbox: {
            id: '22222222-2222-4222-8222-222222222222',
            title: '一篇稍后读',
            originalUrl: 'https://example.com',
            canonicalUrl: 'https://example.com',
            excerpt: null,
            byline: null,
            siteName: null,
            extractedText: null,
            extractedHtml: null,
            status: 'unread',
            source: 'manual',
            capturedAt: '2026-01-01T00:00:00.000Z',
            readAt: null,
            convertedTaskId: null,
            tagIds: [],
            assets: [],
            deletedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      nextCursor: null,
    });
  });

  it('shows empty copy then POST /search results', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <RabRoot>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <SearchPage />
          </MemoryRouter>
        </QueryClientProvider>
      </RabRoot>,
    );
    expect(screen.getByText(t.empty.search)).toBeInTheDocument();
    await user.type(screen.getByLabelText(t.search.placeholder), '稍后');
    await waitFor(() => expect(client.search).toHaveBeenCalledWith({ q: '稍后', limit: 20 }));
    expect(await screen.findByText('一篇稍后读')).toBeInTheDocument();
  });

  it('uses a wide search canvas instead of shrinking to its empty-state content', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <RabRoot>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <SearchPage />
          </MemoryRouter>
        </QueryClientProvider>
      </RabRoot>,
    );

    const canvas = container.firstElementChild;
    expect(canvas).toHaveAttribute('data-region', 'search-canvas');
    expect(canvas).toHaveClass('w-full');
    expect(canvas?.querySelector('.max-w-2xl.mx-auto')).not.toBeNull();
    expect(screen.getByLabelText(t.search.placeholder)).toHaveClass('w-full');
  });
});
