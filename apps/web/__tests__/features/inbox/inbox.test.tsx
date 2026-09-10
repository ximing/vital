import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type InboxItem,
  type InboxPreview,
  type List,
  type Task,
  type UserProfile,
} from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { InboxReader } from '../../../src/features/inbox/InboxReader';
import { InboxWorkspace } from '../../../src/features/inbox/InboxWorkspace';
import { resetInboxUi } from '../../../src/features/inbox/inbox-ui.service';
import { CapturePane } from '../../../src/shell/CapturePane';
import { RabRoot } from '../../helpers/rab-root';

const TZ = 'Asia/Shanghai';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listLists: vi.fn(),
      listOutcomes: vi.fn(),
      listTasks: vi.fn(),
      listTags: vi.fn(),
      createTag: vi.fn(),
      listInbox: vi.fn(),
      getInbox: vi.fn(),
      extractInbox: vi.fn(),
      createInbox: vi.fn(),
      patchInbox: vi.fn(),
      convertInbox: vi.fn(),
      deleteInbox: vi.fn(),
      completeTask: vi.fn(),
      uncompleteTask: vi.fn(),
      updateOnboarding: vi.fn(),
    },
  };
});

const mockUser: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: TZ,
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: {},
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const inboxList: List = {
  id: 'inbox-1',
  kind: 'inbox',
  name: '收集箱',
  color: null,
  icon: null,
  iconAttachmentId: null,
  iconUrl: null,
  parentId: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeTask(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    listId: 'inbox-1',
    parentId: null,
    outcomeId: null,
    estimateMinutes: null,
    deferCount: 0,
    delegable: false,
    habitId: null,
    habitSeq: null,
    notes: '',
    status: 'todo',
    priority: 3,
    pinned: false,
    dueAt: null,
    startAt: null,
    reminderMode: null,
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: true,
    timezone: TZ,
    recurrence: null,
    recurrenceKind: null,
    recurrenceDtstart: null,
    completedAt: null,
    sortOrder: 1024,
    tagIds: [],
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function makeItem(over: Partial<InboxItem> & Pick<InboxItem, 'id' | 'title'>): InboxItem {
  return {
    outcomeId: null,
    originalUrl: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    extractedText: 'Hello',
    extractedHtml: '<p>Hello</p>',
    excerpt: 'Hello',
    byline: null,
    siteName: 'example.com',
    status: 'unread',
    source: 'web',
    capturedAt: '2026-09-06T00:00:00.000Z',
    readAt: null,
    convertedTaskId: null,
    tagIds: [],
    assets: [],
    deletedAt: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    ...over,
  };
}

const preview: InboxPreview = {
  title: 'Example Domain',
  outcomeId: null,
  originalUrl: 'https://example.com/a',
  canonicalUrl: 'https://example.com/a',
  extractedText: 'Hello',
  extractedHtml: '<p>Hello</p>',
  excerpt: 'Hello',
  byline: null,
  siteName: 'example.com',
  status: 'unread',
  source: 'web',
  readAt: null,
  convertedTaskId: null,
  tagIds: [],
  assets: [],
};

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              element={
                <>
                  <CapturePane />
                  <Outlet />
                </>
              }
            >
              <Route path="/inbox" element={<InboxWorkspace />} />
              <Route path="/inbox/:id" element={<InboxReader />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('inbox workspace', () => {
  beforeEach(() => {
    resetInboxUi();
    setAuthForTest(mockUser);
    vi.mocked(client.listInbox).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listLists).mockResolvedValue({ items: [inboxList] });
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.patchInbox).mockImplementation(async (id, _input) =>
      makeItem({ id, title: 'x', readAt: '2026-09-06T00:01:00.000Z' }),
    );
    vi.mocked(client.updateOnboarding).mockResolvedValue({
      ...mockUser,
      onboarding: { capturedInbox: true },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetInboxUi();
  });

  it('marks the selected reader as a constrained reading canvas', async () => {
    renderAt('/inbox');
    const canvas = await screen.findByRole('main');
    expect(canvas).toHaveAttribute('data-region', 'reading-canvas');
    expect(canvas).toHaveClass('min-h-0', 'min-w-0', 'flex-1');
  });

  it('shows the editorial empty state on the canvas and the filter index in the library', async () => {
    renderAt('/inbox');
    expect(await screen.findByText(t.empty.inboxTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.empty.actionExtension })).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    for (const label of Object.values(t.inbox.filters)) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.queryByText(t.empty.inboxReader)).toBeInTheDocument();
  });

  it('lists unread saves on the canvas, not unprocessed todos', async () => {
    vi.mocked(client.listTasks).mockResolvedValue({
      items: [makeTask({ id: 't1', title: '未整理的任务' })],
      nextCursor: null,
    });
    vi.mocked(client.listInbox).mockResolvedValue({
      items: [makeItem({ id: 'i1', title: '未读文章' })],
      nextCursor: null,
    });
    renderAt('/inbox');
    expect(await screen.findByText('未读文章')).toBeInTheDocument();
    expect(screen.getByText('未读文章').closest('[data-density="reading-row"]')).not.toBeNull();
    expect(screen.queryByText('未整理的任务')).not.toBeInTheDocument();
  });

  it('shows a channel tag for plugin and wechat saves', async () => {
    vi.mocked(client.listInbox).mockResolvedValue({
      items: [
        makeItem({ id: 'i1', title: '插件页', source: 'extension' }),
        makeItem({ id: 'i2', title: '微信页', source: 'wechat' }),
      ],
      nextCursor: null,
    });
    renderAt('/inbox');
    expect(await screen.findByText('插件页')).toBeInTheDocument();
    expect(screen.getByText('插件收藏')).toBeInTheDocument();
    expect(screen.getByText('微信收藏')).toBeInTheDocument();
  });

  it('opens archived saves through the library filter nav', async () => {
    vi.mocked(client.listInbox).mockResolvedValue({
      items: [
        makeItem({ id: 'i1', title: '未读文章' }),
        makeItem({ id: 'i2', title: '归档文章', status: 'archived' }),
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderAt('/inbox');
    expect(await screen.findByText('未读文章')).toBeInTheDocument();
    expect(screen.queryByText('归档文章')).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: /归档/ }));
    expect(await screen.findByText('归档文章')).toBeInTheDocument();
    expect(screen.queryByText('未读文章')).not.toBeInTheDocument();
  });

  it('filters favorite saves through the library filter nav', async () => {
    vi.mocked(client.listInbox).mockResolvedValue({
      items: [
        makeItem({ id: 'i1', title: '未读文章' }),
        makeItem({ id: 'i2', title: '收藏文章', status: 'later' }),
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderAt('/inbox');
    expect(await screen.findByText('未读文章')).toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: /收藏/ }));
    expect(await screen.findByText('收藏文章')).toBeInTheDocument();
    expect(screen.queryByText('未读文章')).not.toBeInTheDocument();
  });

  it('filters the canvas list by a library tag', async () => {
    const workTag = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '工作',
      color: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(client.listTags).mockResolvedValue({ items: [workTag] });
    vi.mocked(client.listInbox).mockResolvedValue({
      items: [
        makeItem({ id: 'i1', title: '带标签', tagIds: [workTag.id] }),
        makeItem({ id: 'i2', title: '无标签' }),
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderAt('/inbox');
    expect(await screen.findByText('带标签')).toBeInTheDocument();
    expect(screen.getByText('无标签')).toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: /#工作/ }));
    expect(await screen.findByText('带标签')).toBeInTheDocument();
    expect(screen.queryByText('无标签')).not.toBeInTheDocument();
  });

  it('adds a tag from the reader', async () => {
    const workTag = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '工作',
      color: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const item = makeItem({ id: 'i1', title: '一篇' });
    vi.mocked(client.listInbox).mockResolvedValue({ items: [item], nextCursor: null });
    vi.mocked(client.getInbox).mockResolvedValue(item);
    vi.mocked(client.createTag).mockResolvedValue(workTag);
    vi.mocked(client.patchInbox).mockImplementation(async (id, input) => ({
      ...item,
      ...input,
      tagIds: input.tagIds ?? item.tagIds,
      readAt: input.readAt ?? item.readAt,
    }));
    const user = userEvent.setup();
    renderAt('/inbox/i1');
    expect(await screen.findByRole('heading', { name: '一篇' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(t.todos.addTag), '工作');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(client.createTag).toHaveBeenCalledWith({ name: '工作' });
    });
    await waitFor(() => {
      expect(client.patchInbox).toHaveBeenCalledWith('i1', { tagIds: [workTag.id] });
    });
  });

  it('opens a collection-row context menu with actions and tags', async () => {
    const workTag = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '工作',
      color: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(client.listTags).mockResolvedValue({ items: [workTag] });
    vi.mocked(client.listInbox).mockResolvedValue({
      items: [makeItem({ id: 'i1', title: '未读文章' })],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderAt('/inbox');
    fireEvent.contextMenu(await screen.findByRole('link', { name: /未读文章/ }));
    const menu = screen.getByRole('menu', { name: '未读文章' });
    expect(within(menu).getByText(t.inbox.openItem)).toBeInTheDocument();
    expect(within(menu).getByText(t.inbox.favorite)).toBeInTheDocument();
    expect(within(menu).getByText(t.inbox.archive)).toBeInTheDocument();
    expect(within(menu).getByText(t.inbox.convert)).toBeInTheDocument();
    expect(within(menu).getByText(t.inbox.tags)).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '#工作' })).toBeInTheDocument();
    expect(within(menu).getByText(t.inbox.deleteItem)).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: '#工作' }));
    expect(client.patchInbox).toHaveBeenCalledWith('i1', { tagIds: [workTag.id] });
  });

  it('previews a pasted URL then creates with originalUrl', async () => {
    const created = makeItem({ id: 'i1', title: 'Example Domain' });
    vi.mocked(client.extractInbox).mockResolvedValue(preview);
    vi.mocked(client.createInbox).mockResolvedValue(created);
    vi.mocked(client.getInbox).mockResolvedValue({
      ...created,
      extractedHtml: '<p>Hello</p><script>alert(1)</script>',
    });
    const user = userEvent.setup();
    renderAt('/inbox');
    await user.click((await screen.findAllByRole('button', { name: t.inbox.pasteUrl }))[0]!);
    await screen.findByLabelText(t.inbox.pastePlaceholder);
    await user.type(screen.getByLabelText(t.inbox.pastePlaceholder), 'https://example.com/a');
    await user.click(screen.getByRole('button', { name: t.inbox.extract }));
    expect(await screen.findByRole('button', { name: t.inbox.save })).toBeInTheDocument();
    expect(screen.getByText(t.inbox.preview)).toBeInTheDocument();
    expect(client.extractInbox).toHaveBeenCalledWith({ url: 'https://example.com/a' });
    await user.click(screen.getByRole('button', { name: t.inbox.save }));
    await waitFor(() => {
      expect(client.createInbox).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Example Domain',
          originalUrl: 'https://example.com/a',
          source: 'web',
          extractedHtml: '<p>Hello</p>',
        }),
      );
    });
    expect(await screen.findByRole('link', { name: 'https://example.com/a' })).toBeInTheDocument();
  });

  it('shows processing then failed extract with retry', async () => {
    let rejectExtract: ((err: unknown) => void) | undefined;
    vi.mocked(client.extractInbox).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectExtract = reject;
        }),
    );
    const user = userEvent.setup();
    renderAt('/inbox');
    await user.click((await screen.findAllByRole('button', { name: t.inbox.pasteUrl }))[0]!);
    await screen.findByLabelText(t.inbox.pastePlaceholder);
    await user.type(screen.getByLabelText(t.inbox.pastePlaceholder), 'https://example.com/a');
    await user.click(screen.getByRole('button', { name: t.inbox.extract }));
    expect(await screen.findByText(t.inbox.processing)).toBeInTheDocument();
    expect(rejectExtract).toBeDefined();
    rejectExtract?.(new ApiError(400, 'VALIDATION_ERROR', '地址不可达'));
    expect(await screen.findByRole('button', { name: t.inbox.retry })).toBeInTheDocument();
    expect(screen.getAllByText('地址不可达').length).toBeGreaterThan(0);
    vi.mocked(client.extractInbox).mockResolvedValue(preview);
    await user.click(screen.getByRole('button', { name: t.inbox.retry }));
    expect(await screen.findByRole('button', { name: t.inbox.save })).toBeInTheDocument();
  });
});

describe('inbox reader', () => {
  beforeEach(() => {
    resetInboxUi();
    setAuthForTest(mockUser);
    vi.mocked(client.patchInbox).mockImplementation(async (id) =>
      makeItem({ id, title: 'Example Domain', readAt: '2026-09-06T00:01:00.000Z' }),
    );
    vi.mocked(client.listInbox).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetInboxUi();
  });

  it('purifies html, keeps original URL, and converts without dropping it', async () => {
    const item = makeItem({
      id: 'i1',
      title: 'Example Domain',
      extractedHtml:
        '<p>safe-text</p><script>alert(1)</script><img src="https://x.test/a.png" onerror="alert(1)">',
    });
    vi.mocked(client.getInbox).mockResolvedValue(item);
    vi.mocked(client.convertInbox).mockImplementation(async () => {
      const converted = { ...item, status: 'converted' as const, convertedTaskId: 'task-1' };
      vi.mocked(client.getInbox).mockResolvedValue(converted);
      return {
        inbox: converted,
        task: makeTask({
          id: 'task-1',
          title: item.title,
          notes: item.originalUrl ?? '',
        }),
      };
    });
    const user = userEvent.setup();
    renderAt('/inbox/i1');
    expect(await screen.findByRole('heading', { name: 'Example Domain' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/a' })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('.reader-article')?.textContent).toContain('safe-text');
    });
    expect(document.querySelector('.reader-article script')).toBeNull();
    expect(document.querySelector('.reader-article img')?.getAttribute('onerror')).toBeNull();

    await user.click(screen.getByRole('button', { name: t.inbox.convert }));
    await waitFor(() => {
      expect(client.convertInbox).toHaveBeenCalledWith('i1', {});
    });
    expect(screen.getByText(t.inbox.convertKeptUrl)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/a' })).toBeInTheDocument();
  });

  it('archives, favorites, changes font size, and stubs add-to-report', async () => {
    const item = makeItem({ id: 'i1', title: '一篇' });
    vi.mocked(client.getInbox).mockResolvedValue(item);
    vi.mocked(client.patchInbox).mockImplementation(async (id, input) => ({
      ...item,
      id,
      ...input,
      readAt: '2026-09-06T00:01:00.000Z',
      status: input.status ?? item.status,
    }));
    const user = userEvent.setup();
    renderAt('/inbox/i1');
    expect(await screen.findByRole('heading', { name: '一篇' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.inbox.favorite }));
    await waitFor(() => {
      expect(client.patchInbox).toHaveBeenCalledWith('i1', { status: 'later' });
    });

    await user.click(screen.getByRole('button', { name: t.inbox.archive }));
    await waitFor(() => {
      expect(client.patchInbox).toHaveBeenCalledWith('i1', { status: 'archived' });
    });

    await user.click(screen.getByRole('button', { name: t.inbox.font.lg }));
    expect(document.querySelector('.reader-article')).toHaveAttribute('data-size', 'lg');

    await user.click(screen.getByRole('button', { name: t.inbox.addToReport }));
    expect(screen.getByText(t.inbox.addToReportStub)).toBeInTheDocument();
  });

  it('shows reader empty copy when the item is missing', async () => {
    vi.mocked(client.getInbox).mockRejectedValue(
      new ApiError(404, 'INBOX_NOT_FOUND', '条目不存在'),
    );
    renderAt('/inbox/missing');
    expect(await screen.findByText('条目不存在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.inbox.retry })).toBeInTheDocument();
  });
});
