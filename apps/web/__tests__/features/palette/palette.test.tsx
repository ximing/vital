import type { List, SearchResults } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { CommandPalette } from '../../../src/features/palette/CommandPalette';
import {
  OPEN_PALETTE_EVENT,
  commandItems,
  filterItems,
  isPaletteToggle,
  searchResultsToItems,
} from '../../../src/features/palette/model';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listLists: vi.fn(),
      searchAll: vi.fn(),
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
    iconAttachmentId: null,
    iconUrl: null,
    parentId: null,
    sortOrder: -5,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const groupedResults: SearchResults = {
  tasks: [{ id: 't1', listId: 'inbox-1', title: '买牛奶', status: 'todo' }],
  outcomes: [{ id: 'o1', name: '健康饮食', status: 'open' }],
  inbox: [{ id: 'i1', title: '牛奶测评', excerpt: '乳品' }],
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPalette() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CommandPalette />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('command palette', () => {
  beforeEach(() => {
    vi.mocked(client.listLists).mockResolvedValue({ items: lists });
    vi.mocked(client.searchAll).mockResolvedValue(groupedResults);
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

  it('maps grouped search results to navigation items', () => {
    expect(searchResultsToItems(groupedResults)).toEqual([
      { id: 'task-t1', kind: 'task', title: '买牛奶', hint: t.palette.task, href: '/todos/lists/inbox-1?task=t1' },
      { id: 'outcome-o1', kind: 'outcome', title: '健康饮食', hint: t.palette.outcome, href: '/today/threads/o1' },
      { id: 'inbox-i1', kind: 'inbox', title: '牛奶测评', hint: t.palette.inbox, href: '/inbox/i1' },
    ]);
  });

  it('opens via the rail event and searches with a debounce', async () => {
    const user = userEvent.setup();
    renderPalette();
    fireEvent(window, new CustomEvent(OPEN_PALETTE_EVENT));
    const dialog = await screen.findByRole('dialog', { name: t.nav.palette });
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByLabelText(t.palette.placeholder), '牛奶');
    // Debounced: not called synchronously after typing.
    expect(client.searchAll).not.toHaveBeenCalled();
    await waitFor(() => expect(client.searchAll).toHaveBeenCalledWith('牛奶'), { timeout: 1500 });
  });

  it('renders hits grouped under 任务/线程/收集箱 headers', async () => {
    const user = userEvent.setup();
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', metaKey: true, code: 'KeyK' });
    await screen.findByRole('dialog', { name: t.nav.palette });
    await user.type(screen.getByLabelText(t.palette.placeholder), '牛奶');

    expect(await screen.findByText('买牛奶')).toBeInTheDocument();
    expect(screen.getByText('健康饮食')).toBeInTheDocument();
    expect(screen.getByText('牛奶测评')).toBeInTheDocument();
    // Group headers for the three sections (命令区无 header)。
    const headers = document.querySelectorAll('li[role="presentation"]');
    expect([...headers].map((el) => el.textContent)).toEqual([
      t.palette.task,
      t.palette.outcome,
      t.palette.inbox,
    ]);
  });

  it('navigates to the active hit with keyboard arrows + enter', async () => {
    const user = userEvent.setup();
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', metaKey: true, code: 'KeyK' });
    await screen.findByRole('dialog', { name: t.nav.palette });
    // No command matches "牛奶", so the first hit is the task.
    await user.type(screen.getByLabelText(t.palette.placeholder), '牛奶');
    await screen.findByText('买牛奶');

    fireEvent.keyDown(window, { key: 'ArrowDown' }); // task → outcome
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/today/threads/o1'),
    );
    expect(screen.queryByRole('dialog', { name: t.nav.palette })).not.toBeInTheDocument();
  });

  it('closes on Escape and on backdrop click', async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', metaKey: true, code: 'KeyK' });
    await screen.findByRole('dialog', { name: t.nav.palette });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: t.nav.palette })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true, code: 'KeyK' });
    const dialog = await screen.findByRole('dialog', { name: t.nav.palette });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole('dialog', { name: t.nav.palette })).not.toBeInTheDocument();
  });
});
