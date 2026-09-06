import type { List } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { CommandPalette } from '../../../src/features/palette/CommandPalette';
import { commandItems, filterItems, isPaletteToggle } from '../../../src/features/palette/model';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listLists: vi.fn(),
      search: vi.fn(),
      updateOnboarding: vi.fn(),
    },
  };
});

const lists: List[] = [
  {
    id: 'smart:today',
    kind: 'smart',
    name: '今天',
    color: null,
    icon: null,
    sortOrder: -5,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('command palette', () => {
  beforeEach(() => {
    vi.mocked(client.listLists).mockResolvedValue({ items: lists });
    vi.mocked(client.search).mockResolvedValue({
      items: [
        {
          type: 'task',
          task: {
            id: '11111111-1111-4111-8111-111111111111',
            listId: 'inbox-1',
            parentId: null,
            title: '买牛奶',
            notes: '',
            status: 'todo',
            priority: 3,
            dueAt: null,
            startAt: null,
            remindAt: null,
            isAllDay: true,
            timezone: 'Asia/Shanghai',
            timeBucket: 'anytime',
            recurrence: null,
            recurrenceDtstart: null,
            completedAt: null,
            sortOrder: 1,
            tagIds: [],
            deletedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      nextCursor: null,
    });
  });

  it('toggles on ⌘K / Ctrl+K and not on /', () => {
    expect(isPaletteToggle({ key: 'k', metaKey: true, ctrlKey: false, altKey: false } as KeyboardEvent)).toBe(
      true,
    );
    expect(isPaletteToggle({ key: 'k', metaKey: false, ctrlKey: true, altKey: false } as KeyboardEvent)).toBe(
      true,
    );
    expect(isPaletteToggle({ key: '/', metaKey: false, ctrlKey: false, altKey: false } as KeyboardEvent)).toBe(
      false,
    );
    expect(filterItems(commandItems(), '周报').map((item) => item.title)).toContain(t.reports.weekly);
  });

  it('opens on meta+k and jumps to search hits', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('dialog', { name: t.nav.palette })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', metaKey: true, code: 'KeyK' });
    expect(await screen.findByRole('dialog', { name: t.nav.palette })).toBeInTheDocument();
    expect(screen.getByText(t.lists.today)).toBeInTheDocument();
    await user.type(screen.getByLabelText(t.palette.placeholder), '牛奶');
    await waitFor(() => expect(client.search).toHaveBeenCalledWith({ q: '牛奶', limit: 20 }));
    expect(await screen.findByText('买牛奶')).toBeInTheDocument();
  });
});
