import { Service } from '@rabjs/react';
import { mergeTasksIntoList } from '@vital/api-client';
import type { CalendarInstance, List, ListId, Tag, Task } from '@vital/dto';
import { client } from '../../lib/api';
import { toast } from '../../components/toast';
import { humanError, isNetworkError } from '../../lib/errors';
import { localDateStamp, zonedLocalMidnightIso } from '../../lib/format';
import { addDaysYmd, weekDays } from '../../lib/calendar-grid';
import { pullSync, subscribeSync } from '../../lib/sync';
import { AuthService } from '../../services/auth.service';
import { type TaskListView } from './list-meta';

export class TaskListService extends Service {
  listId: ListId = 'smart:today';
  createFromInbox = false;
  items: Task[] = [];
  lists: List[] = [];
  tags: Tag[] = [];
  cursor: string | null = null;
  error: string | null = null;
  offline = false;
  loading = true;
  refreshing = false;
  inboxCreateId: string | undefined = undefined;
  innerView: TaskListView = 'list';
  weekAnchor = '';
  selectedDay = '';
  instances: CalendarInstance[] = [];
  primed = false;
  doneOpen = false;
  contextTask: Task | null = null;
  movingTask: Task | null = null;

  private unsubSync: (() => void) | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get tz(): string {
    return this.auth.user?.timezone ?? 'UTC';
  }

  get weekStartsOn(): 0 | 1 {
    return this.auth.user?.weekStartsOn === 0 ? 0 : 1;
  }

  attach(listId: ListId, createFromInbox: boolean): void {
    const listChanged = listId !== this.listId;
    this.listId = listId;
    this.createFromInbox = createFromInbox;
    if (this.weekAnchor === '') {
      const today = localDateStamp(this.tz);
      this.weekAnchor = today;
      this.selectedDay = today;
    }
    if (listChanged && this.primed) {
      void this.load(false);
    }
  }

  start(): void {
    if (this.unsubSync) return;
    this.unsubSync = subscribeSync((changes) => {
      if (changes.tasks.length === 0) return;
      if (String(this.listId).startsWith('smart:')) {
        void this.load(false);
      } else {
        this.items = mergeTasksIntoList(this.items, changes.tasks, this.listId);
      }
    });
  }

  stop(): void {
    this.unsubSync?.();
    this.unsubSync = null;
  }

  applyTask(next: Task): void {
    const idx = this.items.findIndex((row) => row.id === next.id);
    this.items = idx < 0 ? [next, ...this.items] : this.items.map((row, i) => (i === idx ? next : row));
  }

  async load(refresh: boolean): Promise<void> {
    if (refresh) this.refreshing = true;
    else this.loading = true;
    try {
      if (this.createFromInbox) {
        const lists = await client.listLists();
        this.inboxCreateId = lists.items.find((row) => row.kind === 'inbox')?.id;
      }
      const [page, listRes, tagRes] = await Promise.all([
        client.listTasks({ listId: this.listId }),
        client.listLists(),
        client.listTags(),
      ]);
      this.items = page.items;
      this.lists = listRes.items;
      this.tags = tagRes.items;
      this.cursor = page.nextCursor;
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

  async loadWeek(anchor = this.weekAnchor): Promise<void> {
    const start = weekDays(anchor, this.weekStartsOn)[0] ?? anchor;
    const from = zonedLocalMidnightIso(this.tz, start);
    const to = new Date(
      new Date(zonedLocalMidnightIso(this.tz, addDaysYmd(start, 7))).getTime() - 1,
    ).toISOString();
    try {
      const res = await client.calendar({ from, to });
      this.instances = res.instances;
    } catch {
      this.instances = [];
    }
  }

  async reloadFromFocus(view: TaskListView): Promise<void> {
    const changes = await pullSync().catch(() => null);
    if (!this.primed) {
      this.primed = true;
      await this.load(false);
      if (view === 'week') await this.loadWeek();
      return;
    }
    if (changes && changes.tasks.length > 0 && String(this.listId).startsWith('smart:')) {
      await this.load(false);
    }
    if (view === 'week' && changes && changes.tasks.length > 0) await this.loadWeek();
  }

  applyMutation(next: Task): void {
    if (String(this.listId).startsWith('smart:')) void this.load(false);
    else this.applyTask(next);
  }

  async patchContext(task: Task, input: Parameters<typeof client.patchTask>[1]): Promise<void> {
    try {
      const next = await client.patchTask(task.id, input);
      this.applyMutation(next);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async removeTask(task: Task): Promise<void> {
    try {
      await client.deleteTask(task.id);
      if (String(this.listId).startsWith('smart:')) await this.load(false);
      else this.items = this.items.filter((row) => row.id !== task.id);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async loadMore(): Promise<void> {
    if (this.cursor === null) return;
    const page = await client.listTasks({ listId: this.listId, cursor: this.cursor });
    this.items = [...this.items, ...page.items];
    this.cursor = page.nextCursor;
  }

  prepend(task: Task): void {
    this.items = [task, ...this.items];
  }

  setInnerView(view: TaskListView): void {
    this.innerView = view;
  }

  setSelectedDay(ymd: string): void {
    this.selectedDay = ymd;
  }

  shiftWeek(days: number, today: string): void {
    const next = days === 0 ? today : addDaysYmd(this.weekAnchor, days);
    this.weekAnchor = next;
    this.selectedDay = next;
    void this.loadWeek(next);
  }

  toggleDoneOpen(): void {
    this.doneOpen = !this.doneOpen;
  }

  openContext(task: Task): void {
    this.contextTask = task;
  }

  closeContext(): void {
    this.contextTask = null;
  }

  openMove(task: Task): void {
    this.movingTask = task;
    this.contextTask = null;
  }

  closeMove(): void {
    this.movingTask = null;
  }
}
