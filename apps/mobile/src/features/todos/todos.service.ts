import { Service } from '@rabjs/react';
import type { List, ListId } from '@vital/dto';
import { listIdSchema } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { isOverdue } from '../../lib/format';
import { AuthService } from '../../services/auth.service';
import { postponeDueAt } from '../today/model';
import { type TaskListView } from './list-meta';

export type ListDraft = { mode: 'create' } | { mode: 'rename'; list: List };

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
  listDraft: ListDraft | null = null;
  listDraftName = '';
  listDraftBusy = false;
  error: string | null = null;
  listEpoch = 0;

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

  openListCreate(): void {
    this.listDraft = { mode: 'create' };
    this.listDraftName = '';
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
        const created = await client.createList({ name: trimmed });
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
