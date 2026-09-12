import { Service } from '@rabjs/react';
import { mergeInboxItems } from '@vital/api-client';
import type { InboxItem, InboxPreview, List, Outcome } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError, isNetworkError } from '../../lib/errors';
import { markOnboarding } from '../../lib/onboarding';
import { pullSync, subscribeSync } from '../../lib/sync';
import { AuthService } from '../../services/auth.service';
import { filterInbox, unreadCount, type InboxFilter } from './model';
import {
  loadReaderFontSize,
  nextReaderFontSize,
  saveReaderFontSize,
  type ReaderFontSize,
} from './reader-font';

const PAGE_LIMIT = 50;

export class InboxService extends Service {
  items: InboxItem[] = [];
  nextCursor: string | null = null;
  error: string | null = null;
  offline = false;
  loading = true;
  refreshing = false;
  loadingMore = false;
  filter: InboxFilter = 'all';
  menuItem: InboxItem | null = null;
  compose = false;
  primed = false;

  private unsubSync: (() => void) | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get tz(): string {
    return this.auth.user?.timezone ?? 'UTC';
  }

  get unread(): number {
    return unreadCount(this.items);
  }

  get visible(): InboxItem[] {
    return filterInbox(this.items, this.filter);
  }

  start(): void {
    if (this.unsubSync) return;
    this.unsubSync = subscribeSync((changes) => {
      if (changes.inbox.length === 0) return;
      this.items = mergeInboxItems(this.items, changes.inbox);
    });
  }

  stop(): void {
    this.unsubSync?.();
    this.unsubSync = null;
  }

  async load(refresh: boolean): Promise<void> {
    if (refresh) this.refreshing = true;
    else this.loading = true;
    try {
      const page = await client.listInbox({ limit: PAGE_LIMIT });
      this.items = page.items.filter((row) => row.deletedAt === null);
      this.nextCursor = page.nextCursor;
      this.error = null;
      this.offline = false;
    } catch (err) {
      this.error = humanError(err);
      this.offline = isNetworkError(err);
    } finally {
      this.loading = false;
      this.refreshing = false;
    }
  }

  async reloadFromFocus(): Promise<void> {
    await pullSync().catch(() => undefined);
    if (!this.primed) {
      this.primed = true;
      await this.load(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.nextCursor === null || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const page = await client.listInbox({ cursor: this.nextCursor, limit: PAGE_LIMIT });
      this.items = mergeInboxItems(this.items, page.items);
      this.nextCursor = page.nextCursor;
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.loadingMore = false;
    }
  }

  mergeItem(next: InboxItem): void {
    this.items = mergeInboxItems(this.items, [next]);
  }

  setFilter(filter: InboxFilter): void {
    this.filter = filter;
  }

  openCompose(): void {
    this.compose = true;
  }

  closeCompose(): void {
    this.compose = false;
  }

  openMenu(item: InboxItem): void {
    this.menuItem = item;
  }

  closeMenu(): void {
    this.menuItem = null;
  }

  async applyPatch(id: string, input: Parameters<typeof client.patchInbox>[1]): Promise<void> {
    try {
      this.mergeItem(await client.patchInbox(id, input));
    } catch (err) {
      toast(humanError(err));
    }
  }

  markRead(item: InboxItem): void {
    void this.applyPatch(item.id, { readAt: new Date().toISOString() });
  }

  async convert(item: InboxItem, openTask: (id: string) => void): Promise<void> {
    try {
      const res = await client.convertInbox(item.id, {});
      this.mergeItem(res.inbox);
      toast({
        message: copy.toast.converted,
        action: { label: copy.inbox.viewTask, onPress: () => openTask(res.task.id) },
      });
    } catch (err) {
      toast(humanError(err));
    }
  }

  async remove(item: InboxItem): Promise<void> {
    try {
      await client.deleteInbox(item.id);
      this.items = this.items.filter((row) => row.id !== item.id);
    } catch (err) {
      toast(humanError(err));
    }
  }
}

export class InboxDetailService extends Service {
  inboxId = '';
  item: InboxItem | null = null;
  lists: List[] = [];
  outcomes: Outcome[] = [];
  error: string | null = null;
  busy = false;
  fontSize: ReaderFontSize = 'md';
  more = false;
  outcomePicker = false;

  private markedRead: string | null = null;
  private fontLoaded = false;

  configure(inboxId: string): void {
    if (this.inboxId !== inboxId) {
      this.inboxId = inboxId;
      this.item = null;
      this.error = null;
      this.markedRead = null;
    }
    if (!this.fontLoaded) {
      this.fontLoaded = true;
      void loadReaderFontSize().then((size) => {
        this.fontSize = size;
      });
    }
  }

  async load(): Promise<void> {
    try {
      const [next, listRes, outcomeRes] = await Promise.all([
        client.getInbox(this.inboxId),
        client.listLists(),
        client.listOutcomes('open'),
      ]);
      this.item = next;
      this.lists = listRes.items;
      this.outcomes = outcomeRes;
      this.error = null;
      this.markReadIfNeeded();
    } catch (err) {
      this.error = humanError(err);
    }
  }

  private markReadIfNeeded(): void {
    const item = this.item;
    if (!item || item.readAt !== null || this.markedRead === item.id) return;
    this.markedRead = item.id;
    void client
      .patchInbox(item.id, { readAt: new Date().toISOString() })
      .then((next) => {
        this.item = next;
      })
      .catch(() => undefined);
  }

  cycleFontSize(): void {
    const next = nextReaderFontSize(this.fontSize);
    this.fontSize = next;
    saveReaderFontSize(next);
  }

  openMore(): void {
    this.more = true;
  }

  closeMore(): void {
    this.more = false;
  }

  openOutcomePicker(): void {
    this.outcomePicker = true;
  }

  closeOutcomePicker(): void {
    this.outcomePicker = false;
  }

  async patch(input: Parameters<typeof client.patchInbox>[1]): Promise<void> {
    if (this.item === null) return;
    try {
      this.item = await client.patchInbox(this.item.id, input);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async convert(openTask: (id: string) => void): Promise<void> {
    if (this.item === null || this.item.status === 'converted') return;
    this.busy = true;
    try {
      const inboxList = this.lists.find((row) => row.kind === 'inbox');
      const res = await client.convertInbox(this.item.id, inboxList ? { listId: inboxList.id } : {});
      this.item = res.inbox;
      toast({
        message: copy.toast.converted,
        action: { label: copy.inbox.viewTask, onPress: () => openTask(res.task.id) },
      });
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.busy = false;
    }
  }

  async remove(): Promise<boolean> {
    if (this.item === null) return false;
    try {
      await client.deleteInbox(this.item.id);
      return true;
    } catch (err) {
      toast(humanError(err));
      return false;
    }
  }
}

export class InboxComposeService extends Service {
  url = '';
  title = '';
  preview: InboxPreview | null = null;
  error: string | null = null;
  busy = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  setUrl(url: string): void {
    this.url = url;
  }

  setTitle(title: string): void {
    this.title = title;
  }

  async extract(): Promise<void> {
    const trimmed = this.url.trim();
    if (trimmed === '') return;
    this.busy = true;
    this.error = null;
    try {
      const next = await client.extractInbox({ url: trimmed });
      this.preview = next;
      if (this.title.trim() === '') this.title = next.title;
    } catch (err) {
      this.error = humanError(err);
    } finally {
      this.busy = false;
    }
  }

  async save(): Promise<InboxItem | null> {
    const trimmedTitle = (this.title.trim() || this.preview?.title || '').trim();
    if (trimmedTitle === '') {
      this.error = copy.auth.invalidRegister;
      return null;
    }
    this.busy = true;
    this.error = null;
    try {
      const href = this.url.trim();
      const item = await client.createInbox({
        title: trimmedTitle,
        originalUrl: href.startsWith('http://') || href.startsWith('https://') ? href : null,
        extractedText: this.preview?.extractedText ?? null,
        extractedHtml: this.preview?.extractedHtml ?? null,
        excerpt: this.preview?.excerpt ?? null,
        byline: this.preview?.byline ?? null,
        siteName: this.preview?.siteName ?? null,
        source: href === '' ? 'manual' : 'mobile',
      });
      toast(copy.toast.saved);
      await markOnboarding(this.auth.user, (next) => this.auth.refreshUser(next), { capturedInbox: true });
      return item;
    } catch (err) {
      this.error = humanError(err);
      return null;
    } finally {
      this.busy = false;
    }
  }
}
