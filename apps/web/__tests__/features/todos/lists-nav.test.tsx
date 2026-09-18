import type { List } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { UserListsNav } from '../../../src/features/todos/ListsNav';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listLists: vi.fn(),
      taskCounts: vi.fn(),
      createList: vi.fn(),
      patchList: vi.fn(),
      deleteList: vi.fn(),
    },
  };
});

function makeList(over: Partial<List> & Pick<List, 'id' | 'name'>): List {
  return {
    kind: 'user',
    color: null,
    icon: null,
    iconAttachmentId: null,
    iconUrl: null,
    parentId: null,
    sortOrder: 0,
    pinned: false,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function renderNav(items: List[]) {
  vi.mocked(client.listLists).mockResolvedValue({ items });
  vi.mocked(client.taskCounts).mockResolvedValue({ counts: { p: 1, c: 2 } });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/todos/lists/p']}>
          <UserListsNav />
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('UserListsNav', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('nests a child list and sums descendant counts on the parent', async () => {
    renderNav([
      makeList({ id: 'p', name: '工作', sortOrder: 1 }),
      makeList({ id: 'c', name: '本周', parentId: 'p', sortOrder: 1 }),
    ]);
    expect(await screen.findByText('工作')).toBeInTheDocument();
    const childLink = screen.getByRole('link', { name: /本周/ });
    expect(childLink.parentElement).toHaveClass('pl-6');
    expect(screen.getByRole('link', { name: /工作/ }).textContent).toContain('3');
  });

  it('opens a collection context menu on right click with icons', async () => {
    renderNav([makeList({ id: 'p', name: '工作', sortOrder: 1 })]);
    const link = await screen.findByRole('link', { name: /工作/ });
    fireEvent.contextMenu(link, { clientX: 42, clientY: 88 });
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent(t.todos.renameList);
    expect(menu).toHaveTextContent(t.todos.setListIcon);
    expect(menu).toHaveTextContent(t.todos.pin);
    expect(menu).toHaveTextContent(t.todos.newChildList);
    expect(menu).toHaveTextContent(t.todos.deleteList);
    expect(menu.querySelectorAll('svg').length).toBeGreaterThanOrEqual(4);
    expect(menu.className).toContain('fixed');
    expect(menu).toHaveStyle({ left: '42px', top: '88px' });
  });

  it('pins a collection from the context menu', async () => {
    vi.mocked(client.patchList).mockResolvedValue(
      makeList({ id: 'p', name: '工作', pinned: true, sortOrder: 1 }),
    );
    renderNav([makeList({ id: 'p', name: '工作', sortOrder: 1 })]);
    fireEvent.contextMenu(await screen.findByRole('link', { name: /工作/ }), {
      clientX: 20,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: t.todos.pin }));
    await waitFor(() => {
      expect(client.patchList).toHaveBeenCalledWith('p', { pinned: true });
    });
  });

  it('opens the icon panel when the collection glyph is clicked', async () => {
    renderNav([makeList({ id: 'p', name: '工作', sortOrder: 1 })]);
    fireEvent.click(await screen.findByRole('button', { name: t.todos.setListIcon }));
    expect(screen.getByRole('dialog', { name: t.todos.setListIcon })).toBeInTheDocument();
  });

  it('asks in a dialog before deleting a collection', async () => {
    vi.mocked(client.deleteList).mockResolvedValue(undefined);
    renderNav([makeList({ id: 'p', name: '工作', sortOrder: 1 })]);
    fireEvent.contextMenu(await screen.findByRole('link', { name: /工作/ }), {
      clientX: 20,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: t.todos.deleteList }));
    expect(screen.getByRole('dialog', { name: t.todos.deleteList })).toBeInTheDocument();
    expect(screen.getByText(t.todos.deleteListConfirm)).toBeInTheDocument();
    expect(client.deleteList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t.todos.deleteList }));
    await waitFor(() => {
      expect(client.deleteList).toHaveBeenCalledWith('p');
    });
  });

  it('keeps the icon panel open for internal scrolling and closes for outside scrolling', async () => {
    renderNav([makeList({ id: 'p', name: '工作', sortOrder: 1 })]);
    fireEvent.click(await screen.findByRole('button', { name: t.todos.setListIcon }));
    const panel = screen.getByRole('dialog', { name: t.todos.setListIcon });
    fireEvent.scroll(panel.firstElementChild!);
    expect(panel).toBeInTheDocument();
    fireEvent.scroll(panel);
    expect(panel).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(panel).not.toBeInTheDocument();
  });
});
