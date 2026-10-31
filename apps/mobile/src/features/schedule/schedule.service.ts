import { Service } from '@rabjs/react';
import type { CalendarInstance } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { localDateStamp } from '../../lib/format';
import { pullSync, subscribeSnapshot } from '../../lib/sync';
import { notifyTaskMutation, subscribeTaskMutations } from '../../lib/task-mutations';
import { AuthService } from '../../services/auth.service';
import type { ScheduleCreateRange } from './gesture';
import type { ScheduleChip, ScheduleView } from './place';
import { scheduleRangeIso, shiftScheduleCursor } from './place';

export type ScheduleTimeEdit = {
  taskId: string;
  startAt: string;
  dueAt: string;
  isAllDay: boolean;
};

export type ScheduleMore = {
  ymd: string;
  chips: ScheduleChip[];
};

export class ScheduleService extends Service {
  view: ScheduleView = 'week';
  cursorYmd = '';
  instances: CalendarInstance[] = [];
  error: string | null = null;
  draft: ScheduleCreateRange | null = null;
  draftTitle = '';
  saving = false;
  more: ScheduleMore | null = null;

  private unsubSnapshot: (() => void) | null = null;
  private unsubTasks: (() => void) | null = null;
  private loadToken = 0;
  private selfReload = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get timeZone(): string {
    return this.auth.user?.timezone || 'UTC';
  }

  get weekStartsOn(): 0 | 1 {
    return this.auth.user?.weekStartsOn === 0 ? 0 : 1;
  }

  start(): void {
    this.ensureCursor();
    if (this.unsubSnapshot) return;
    this.unsubSnapshot = subscribeSnapshot((reason) => {
      if (reason === 'periodic') return;
      void this.reload();
    });
    this.unsubTasks = subscribeTaskMutations(() => {
      if (this.selfReload) return;
      void this.reload();
    });
  }

  stop(): void {
    this.unsubSnapshot?.();
    this.unsubSnapshot = null;
    this.unsubTasks?.();
    this.unsubTasks = null;
  }

  ensureCursor(): void {
    if (this.cursorYmd === '') this.cursorYmd = localDateStamp(this.timeZone);
  }

  async reload(): Promise<void> {
    this.ensureCursor();
    const token = ++this.loadToken;
    const cursor = this.cursorYmd;
    const view = this.view;
    try {
      const range = scheduleRangeIso(cursor, view, this.weekStartsOn, this.timeZone);
      const res = await client.calendar(range);
      if (token !== this.loadToken) return;
      this.instances = res.instances;
      this.error = null;
    } catch (err) {
      if (token !== this.loadToken) return;
      this.error = humanError(err);
    }
  }

  async reloadFromFocus(): Promise<void> {
    await pullSync().catch(() => null);
    await this.reload();
  }

  setView(view: ScheduleView): void {
    if (this.view === view) return;
    this.view = view;
    this.draft = null;
    this.more = null;
    void this.reload();
  }

  shift(dir: -1 | 1): void {
    this.ensureCursor();
    this.cursorYmd = shiftScheduleCursor(this.cursorYmd, this.view, dir);
    this.draft = null;
    this.more = null;
    void this.reload();
  }

  goToday(): void {
    this.cursorYmd = localDateStamp(this.timeZone);
    this.draft = null;
    this.more = null;
    void this.reload();
  }

  openDay(ymd: string): void {
    this.cursorYmd = ymd;
    this.view = 'day';
    this.draft = null;
    this.more = null;
    void this.reload();
  }

  setDraft(range: ScheduleCreateRange | null): void {
    this.draft = range;
    if (range === null) this.draftTitle = '';
  }

  setDraftTitle(title: string): void {
    this.draftTitle = title;
  }

  openMore(ymd: string, chips: ScheduleChip[]): void {
    this.more = { ymd, chips };
  }

  closeMore(): void {
    this.more = null;
  }

  async submitDraft(): Promise<void> {
    const draft = this.draft;
    const title = this.draftTitle.trim();
    if (draft === null || title === '' || this.saving) return;
    this.saving = true;
    try {
      const lists = await client.listLists();
      const inboxId = lists.items.find((row) => row.kind === 'inbox')?.id;
      if (inboxId === undefined) {
        toast(copy.schedule.noInbox);
        return;
      }
      await client.createTask({
        title,
        listId: inboxId,
        startAt: draft.startAt,
        dueAt: draft.dueAt,
        isAllDay: draft.isAllDay,
        timezone: this.timeZone,
      });
      this.draft = null;
      this.draftTitle = '';
      this.selfReload = true;
      notifyTaskMutation();
      this.selfReload = false;
      await this.reload();
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.saving = false;
    }
  }

  async applyEdit(edit: ScheduleTimeEdit): Promise<void> {
    try {
      await client.patchTask(edit.taskId, {
        startAt: edit.startAt,
        dueAt: edit.dueAt,
        isAllDay: edit.isAllDay,
      });
      this.selfReload = true;
      notifyTaskMutation();
      this.selfReload = false;
      await this.reload();
    } catch (err) {
      toast(humanError(err));
    }
  }
}
