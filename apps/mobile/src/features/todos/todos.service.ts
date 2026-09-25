import { Service } from '@rabjs/react';
import type { List, ListId } from '@vital/dto';
import { listIdSchema } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { subscribeSnapshot } from '../../lib/sync';
import { humanError } from '../../lib/errors';
import { isOverdue } from '../../lib/format';
import { AuthService } from '../../services/auth.service';
import { postponeDueAt } from '../today/model';
import { type TaskListView } from './list-meta';

export type ListDraft =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; list: List };

const DEFAULT_LIST: ListId = 'smart:today';

export class TodosService extends Service {
  lists: List[] = [];
  counts: Record<string, number> = {};
  listId: ListId = DEFAULT_LIST;
  view: TaskListView = 'list';
  overdueCount = 0;
  drawer = false;
  more = false;
  compose = false;
  manageTarget: List | null = null;
  iconTarget: List | null = null;
  listDraft: ListDraft | null = null;
  listDraftName = '';
  listDraftBusy = false;
  error: string | null = null;
  listEpoch = 0;

  private unsubSnapshot: (() => void) | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get tz(): string {
    return this.auth.user?.timezone ?? 'UTC';
  }

  get current(): List | undefined {
    return this.lists.find((row) => row.id === this.listId);
  }

  get inboxId(): string | undefined {
    return this.lists.find((row) => row.kind === 'inbox')?.id;
  }

  start(): void {
    if (this.unsubSnapshot) return;
    this.unsubSnapshot = subscribeSnapshot((reason) => {
      if (reason === 'periodic') return;
      void this.load();
    });
  }

  stop(): void {
    this.unsubSnapshot?.();
    this.unsubSnapshot = null;
  }

  async load(): Promise<void> {
    try {
      const [listRes, countRes] = await Promise.all([client.listLists(), client.taskCounts()]);
      this.lists = listRes.items;
      this.counts = countRes.counts;
      this.error = null;
    } catch (err) {
      this.error = humanError(err);
    }
  }

  selectList(id: string): void {
    const parsed = listIdSchema.safeParse(id);
    if (!parsed.success) return;
    this.listId = parsed.data;
    this.drawer = false;
    this.more = false;
  }

  setView(view: TaskListView): void {
    this.view = view;
    this.more = false;
  }

  openDrawer(): void {
    this.drawer = true;
  }

  closeDrawer(): void {
    this.drawer = false;
  }

  openMore(): void {
    this.more = true;
  }

  closeMore(): void {
    this.more = false;
  }

  openCompose(): void {
    this.compose = true;
  }

  closeCompose(): void {
    this.compose = false;
  }

  setOverdueCount(count: number): void {
    this.overdueCount = count;
  }

  bumpList(): void {
    this.listEpoch += 1;
  }

  openManage(list: List): void {
    this.manageTarget = list;
  }

  closeManage(): void {
    this.manageTarget = null;
  }

  openListCreate(parentId: string | null = null): void {
    this.manageTarget = null;
    this.listDraft = { mode: 'create', parentId };
    this.listDraftName = '';
  }

  openIcon(list: List): void {
    this.manageTarget = null;
    this.iconTarget = list;
  }

  closeIcon(): void {
    this.iconTarget = null;
  }

  async setListIcon(icon: string | null): Promise<void> {
    const list = this.iconTarget;
    if (list === null) return;
    try {
      await client.patchList(list.id, { icon, iconAttachmentId: null });
      this.iconTarget = null;
      await this.load();
    } catch (err) {
      toast(humanError(err));
    }
  }

  async pickListIcon(): Promise<void> {
    const list = this.iconTarget;
    if (list === null) return;
    this.iconTarget = null;
    try {
      const { pickAndUploadImage } = await import('../../lib/pick-image');
      const picked = await pickAndUploadImage();
      if (picked === null) return;
      await client.bindUpload(picked.id, { ownerType: 'list', ownerId: list.id });
      await client.patchList(list.id, { iconAttachmentId: picked.id, icon: null });
      await this.load();
    } catch (err) {
      toast(humanError(err));
    }
  }

  openListRename(list: List): void {
    this.manageTarget = null;
    this.listDraft = { mode: 'rename', list };
    this.listDraftName = list.name;
  }

  closeListDraft(): void {
    this.listDraft = null;
    this.listDraftName = '';
  }

  setListDraftName(name: string): void {
    this.listDraftName = name;
  }

  async submitListDraft(): Promise<void> {
    const trimmed = this.listDraftName.trim();
    if (trimmed === '' || this.listDraftBusy || this.listDraft === null) return;
    this.listDraftBusy = true;
    try {
      if (this.listDraft.mode === 'create') {
        const created = await client.createList({
          name: trimmed,
          ...(this.listDraft.parentId ? { parentId: this.listDraft.parentId } : {}),
        });
        this.listDraft = null;
        await this.load();
        this.selectList(created.id);
      } else {
        await client.patchList(this.listDraft.list.id, { name: trimmed });
        this.listDraft = null;
        await this.load();
      }
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.listDraftBusy = false;
    }
  }

  async pinList(list: List): Promise<void> {
    try {
      await client.patchList(list.id, { pinned: !list.pinned });
      await this.load();
    } catch (err) {
      toast(humanError(err));
    }
  }

  async archiveList(list: List): Promise<void> {
    try {
      await client.patchList(list.id, { isArchived: true });
      if (list.id === this.listId) this.selectList('smart:today');
      await this.load();
    } catch (err) {
      toast(humanError(err));
    }
  }

  async deleteList(list: List): Promise<void> {
    try {
      await client.deleteList(list.id);
      if (list.id === this.listId) this.selectList('smart:today');
      await this.load();
    } catch (err) {
      toast(humanError(err));
    }
  }

  async postponeOverdue(): Promise<void> {
    try {
      const page = await client.listTasks({ listId: this.listId });
      const overdue = page.items.filter((task) => isOverdue(task));
      await Promise.all(
        overdue.map((task) => {
          const dueAt = postponeDueAt(task, this.tz);
          if (dueAt === null) return Promise.resolve();
          return client.patchTask(task.id, { dueAt });
        }),
      );
      this.bumpList();
      await this.load();
    } catch (err) {
      this.error = humanError(err);
    }
  }
}
