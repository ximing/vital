import { Service } from '@rabjs/react';
import type { AgentAction, List, Outcome, PatchTaskInput, Tag, Task, TaskDraftTrigger } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import {
  formatHm,
  fromDatetimeLocal,
  localDateStamp,
  zonedLocalMidnightIso,
} from '../../lib/format';
import { scheduleDayPatch } from '../../lib/schedule';
import { AuthService } from '../../services/auth.service';
import { toggleComplete } from './complete';
import {
  applyServerText,
  mergeLoadedText,
  textPatch,
  titleIsDirty,
  type TextDraft,
} from './task-text';

const TEXT_SAVE_MS = 600;

export class TaskSheetService extends Service {
  taskId = '';
  task: Task | null = null;
  parent: Task | null = null;
  lists: List[] = [];
  tags: Tag[] = [];
  outcomes: Outcome[] = [];
  decompose: AgentAction | null = null;
  draft: TaskDraftTrigger | null = null;
  title = '';
  notes = '';
  titleDirty = false;
  notesDirty = false;
  saveState: 'idle' | 'editing' | 'saving' | 'saved' | 'error' = 'idle';
  savedAt: number | null = null;
  listOpen = false;
  moreOpen = false;
  tagOpen = false;
  subAddToken = 0;
  subtasks: Task[] = [];
  agentBusy = false;

  private textTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get zone(): string {
    return this.task?.timezone || this.auth.user?.timezone || 'UTC';
  }

  get weekStartsOn(): 0 | 1 {
    return this.auth.user?.weekStartsOn === 0 ? 0 : 1;
  }

  get namedTags(): Tag[] {
    if (this.task === null) return [];
    return this.tags.filter((tag) => this.task!.tagIds.includes(tag.id));
  }

  get doneSubtasks(): number {
    return this.subtasks.filter((row) => row.status === 'done').length;
  }

  get saveLabel(): string | null {
    if (this.saveState === 'editing') return copy.todos.unsaved;
    if (this.saveState === 'saving') return copy.todos.saving;
    if (this.saveState === 'error') return `${copy.todos.saveFailed} · ${copy.todos.retry}`;
    if (this.saveState === 'saved' && this.savedAt !== null) {
      const at = new Date(this.savedAt);
      const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      return copy.todos.savedAt.replace('{time}', hm);
    }
    return null;
  }

  configure(taskId: string): void {
    if (this.taskId === taskId) return;
    this.flushLeavingTask();
    this.taskId = taskId;
    this.task = null;
    this.parent = null;
    this.title = '';
    this.notes = '';
    this.titleDirty = false;
    this.notesDirty = false;
    this.saveState = 'idle';
    this.savedAt = null;
    this.subtasks = [];
    this.outcomes = [];
    this.decompose = null;
    this.draft = null;
    this.listOpen = false;
    this.moreOpen = false;
    this.tagOpen = false;
    this.subAddToken = 0;
    this.agentBusy = false;
  }

  private draftSnapshot(): TextDraft {
    return {
      title: this.title,
      notes: this.notes,
      titleDirty: this.titleDirty,
      notesDirty: this.notesDirty,
    };
  }

  private writeDraft(next: TextDraft): void {
    this.title = next.title;
    this.notes = next.notes;
    this.titleDirty = next.titleDirty;
    this.notesDirty = next.notesDirty;
  }

  applyTask(next: Task): void {
    const merged = mergeLoadedText(this.draftSnapshot(), next);
    const shouldSave = merged.titleDirty || merged.notesDirty;
    this.task = next;
    this.writeDraft(merged);
    if (shouldSave) this.scheduleTextSave();
  }

  async load(): Promise<void> {
    const id = this.taskId;
    if (id === '') return;
    try {
      const [next, listRes, tagRes] = await Promise.all([
        client.getTask(id),
        client.listLists(),
        client.listTags(),
      ]);
      if (this.taskId !== id) return;
      const stale = this.task !== null && next.updatedAt < this.task.updatedAt;
      if (!stale) this.applyTask(next);
      this.lists = listRes.items.filter((row) => row.kind === 'user' || row.kind === 'inbox');
      this.tags = tagRes.items;
      if (next.parentId) {
        try {
          const parent = await client.getTask(next.parentId);
          if (this.taskId === id) this.parent = parent;
        } catch {
          if (this.taskId === id) this.parent = null;
        }
      } else if (this.taskId === id) {
        this.parent = null;
      }
      await this.reloadSubtasks();
      void this.loadContext();
    } catch (err) {
      toast(humanError(err));
    }
  }

  private async loadContext(): Promise<void> {
    const id = this.taskId;
    if (id === '') return;
    try {
      const [outcomes, actions, draft] = await Promise.all([
        client.listOutcomes('open'),
        client.listAgentActions({ targetType: 'task', targetId: id, feedback: 'pending' }),
        client.getTaskDraft(id),
      ]);
      if (this.taskId !== id) return;
      this.outcomes = outcomes;
      this.decompose = actions.find((row) => row.actionType === 'task.decompose') ?? null;
      this.draft = draft;
    } catch {
      // Thread, decompose, and draft are secondary to the open task.
    }
  }

  async reloadSubtasks(): Promise<void> {
    const parent = this.task;
    if (parent === null) {
      this.subtasks = [];
      return;
    }
    try {
      const res = await client.listTasks({ listId: parent.listId, limit: 100 });
      if (this.task?.id !== parent.id) return;
      this.subtasks = res.items.filter((item) => item.parentId === parent.id);
    } catch (err) {
      toast(humanError(err));
    }
  }

  setTitle(title: string): void {
    this.title = title;
    this.titleDirty = this.task === null ? title.trim() !== '' : titleIsDirty(this.task.title, title);
    this.touchEditing();
    this.scheduleTextSave();
  }

  setNotes(notes: string): void {
    this.notes = notes;
    this.notesDirty = this.task === null ? notes !== '' : notes !== this.task.notes;
    this.touchEditing();
    this.scheduleTextSave();
  }

  private touchEditing(): void {
    if ((this.titleDirty || this.notesDirty) && this.saveState !== 'saving') {
      this.saveState = 'editing';
    }
  }

  private scheduleTextSave(): void {
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = null;
    if (!this.titleDirty && !this.notesDirty) return;
    this.textTimer = setTimeout(() => {
      this.textTimer = null;
      void this.flushText();
    }, TEXT_SAVE_MS);
  }

  private clearTextTimer(): void {
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = null;
  }

  /** Persist title/notes now. Safe to call when the sheet closes or the field blurs. */
  async flushText(): Promise<void> {
    this.clearTextTimer();
    await this.enqueue(() => this.flushTextNow());
  }

  private async flushTextNow(): Promise<void> {
    const task = this.task;
    if (task === null) return;
    if (this.title.trim() === '') this.title = task.title;
    this.titleDirty = titleIsDirty(task.title, this.title);
    this.notesDirty = this.notes !== task.notes;
    const input = textPatch(task, this.title, this.notes);
    if (input === null) {
      if (this.saveState === 'editing' || this.saveState === 'saving') this.saveState = 'idle';
      return;
    }
    this.saveState = 'saving';
    await this.patchNow(input);
  }

  /** Sheet switched tasks: save the previous draft without writing it onto the next one. */
  private flushLeavingTask(): void {
    const previous = this.task;
    if (previous === null) {
      this.clearTextTimer();
      return;
    }
    const input = textPatch(previous, this.title, this.notes);
    this.clearTextTimer();
    if (input === null) return;
    const id = previous.id;
    void this.enqueue(async () => {
      try {
        await client.patchTask(id, input);
      } catch (err) {
        toast(humanError(err));
      }
    });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.chain.then(work, work);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async patch(input: PatchTaskInput): Promise<void> {
    await this.enqueue(() => this.patchNow(input));
  }

  private async patchNow(input: PatchTaskInput): Promise<void> {
    const task = this.task;
    if (task === null) return;
    try {
      const next = await client.patchTask(task.id, input);
      if (this.taskId !== task.id) return;
      const merged = applyServerText(this.draftSnapshot(), next, {
        title: input.title,
        notes: input.notes,
      });
      const stillDirty = merged.titleDirty || merged.notesDirty;
      this.task = next;
      this.writeDraft(merged);
      if (input.title !== undefined || input.notes !== undefined) {
        if (stillDirty) this.scheduleTextSave();
        else {
          this.saveState = 'saved';
          this.savedAt = Date.now();
        }
      }
    } catch (err) {
      if (input.title !== undefined || input.notes !== undefined) this.saveState = 'error';
      toast(humanError(err));
    }
  }

  retrySave(): void {
    void this.flushText();
  }

  openList(): void {
    if (this.task?.parentId) return;
    this.listOpen = true;
  }

  closeList(): void {
    this.listOpen = false;
  }

  openMore(): void {
    this.moreOpen = true;
  }

  closeMore(): void {
    this.moreOpen = false;
  }

  openTags(): void {
    this.tagOpen = true;
  }

  closeTags(): void {
    this.tagOpen = false;
  }

  bumpSubAdd(): void {
    this.subAddToken += 1;
  }

  async complete(): Promise<void> {
    await this.flushText();
    const task = this.task;
    if (task === null) return;
    await this.enqueue(async () => {
      if (this.task?.id !== task.id) return;
      await toggleComplete(this.task, (next) => this.applyTask(next), {
        user: this.auth.user,
        refreshUser: (next) => this.auth.refreshUser(next),
      });
    });
  }

  async addSubtask(title: string): Promise<void> {
    const name = title.trim();
    const parent = this.task;
    if (name === '' || parent === null) return;
    try {
      const created = await client.createTask({ title: name, listId: parent.listId, parentId: parent.id });
      this.subtasks = [...this.subtasks, created];
    } catch (err) {
      toast(humanError(err));
    }
  }

  async toggleSubtask(row: Task): Promise<void> {
    if (row.status === 'done') {
      try {
        const next = await client.patchTask(row.id, { status: 'todo' });
        this.subtasks = this.subtasks.map((item) => (item.id === next.id ? next : item));
      } catch (err) {
        toast(humanError(err));
      }
      return;
    }
    await toggleComplete(row, (next) => {
      this.subtasks = this.subtasks.map((item) => (item.id === next.id ? next : item));
    });
  }

  async selectList(listId: string): Promise<void> {
    this.listOpen = false;
    if (this.task?.parentId) return;
    await this.patch({ listId });
    await this.reloadSubtasks();
  }

  async toggleTag(tagId: string): Promise<void> {
    if (this.task === null) return;
    const on = this.task.tagIds.includes(tagId);
    const tagIds = on ? this.task.tagIds.filter((id) => id !== tagId) : [...this.task.tagIds, tagId];
    await this.patch({ tagIds });
  }

  async createTag(name: string): Promise<void> {
    const trimmed = name.trim();
    const task = this.task;
    if (trimmed === '' || task === null) return;
    const existing = this.tags.find((tag) => tag.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      if (!task.tagIds.includes(existing.id)) await this.toggleTag(existing.id);
      return;
    }
    try {
      const created = await client.createTag({ name: trimmed });
      this.tags = [...this.tags, created];
      const current = this.task;
      if (current === null) return;
      await this.patch({ tagIds: [...current.tagIds, created.id] });
    } catch (err) {
      toast(humanError(err));
    }
  }

  async togglePin(): Promise<void> {
    if (this.task === null || this.task.parentId) return;
    this.moreOpen = false;
    await this.patch({ pinned: !this.task.pinned });
  }

  async abandon(): Promise<boolean> {
    if (this.task === null) return false;
    this.moreOpen = false;
    await this.patch({ status: 'canceled' });
    return true;
  }

  async remove(): Promise<boolean> {
    if (this.task === null) return false;
    try {
      await client.deleteTask(this.task.id);
      this.moreOpen = false;
      return true;
    } catch (err) {
      toast(humanError(err));
      return false;
    }
  }

  setDue(value: string): void {
    const task = this.task;
    if (task === null) return;
    if (value === '') {
      void this.patch({ dueAt: null });
      return;
    }
    const iso = task.isAllDay
      ? zonedLocalMidnightIso(this.zone, value)
      : fromDatetimeLocal(value, this.zone);
    void this.patch({ dueAt: iso, isAllDay: task.isAllDay });
  }

  setStart(value: string): void {
    const task = this.task;
    if (task === null) return;
    if (value === '') {
      void this.patch({ startAt: null });
      return;
    }
    const iso = task.isAllDay
      ? zonedLocalMidnightIso(this.zone, value)
      : fromDatetimeLocal(value, this.zone);
    void this.patch({ startAt: iso });
  }

  setAllDay(next: boolean): void {
    const task = this.task;
    if (task === null || task.dueAt === null || task.isAllDay === next) return;
    const zone = this.zone;
    const dueYmd = localDateStamp(zone, new Date(task.dueAt));
    if (next) {
      const input: PatchTaskInput = {
        isAllDay: true,
        dueAt: zonedLocalMidnightIso(zone, dueYmd),
      };
      if (task.startAt) {
        input.startAt = zonedLocalMidnightIso(zone, localDateStamp(zone, new Date(task.startAt)));
      }
      void this.patch(input);
      return;
    }
    const hm = formatHm(task.dueAt, zone);
    const input: PatchTaskInput = {
      isAllDay: false,
      dueAt: fromDatetimeLocal(`${dueYmd}T${hm === '00:00' ? '09:00' : hm}`, zone),
    };
    if (task.startAt) {
      const startYmd = localDateStamp(zone, new Date(task.startAt));
      const startHm = formatHm(task.startAt, zone);
      input.startAt = fromDatetimeLocal(`${startYmd}T${startHm === '00:00' ? '09:00' : startHm}`, zone);
    }
    void this.patch(input);
  }

  scheduleOn(ymd: string): void {
    if (this.task === null) return;
    void this.patch(scheduleDayPatch(this.task, ymd, this.zone));
  }

  clearSchedule(): void {
    void this.patch({ startAt: null, dueAt: null, isAllDay: true });
  }

  setEstimate(minutes: number | null): void {
    void this.patch({ estimateMinutes: minutes });
  }

  setOutcome(outcomeId: string | null): void {
    void this.patch({ outcomeId });
  }

  setDelegable(delegable: boolean): void {
    void this.patch({ delegable });
  }

  async refreshDraft(): Promise<void> {
    const id = this.taskId;
    if (id === '') return;
    try {
      const draft = await client.getTaskDraft(id);
      if (this.taskId === id) this.draft = draft;
    } catch {
      // The next poll retries.
    }
  }

  async triggerDraft(): Promise<void> {
    if (this.task === null || this.agentBusy) return;
    const id = this.task.id;
    this.agentBusy = true;
    this.draft = { status: 'queued', action: this.draft?.action ?? null };
    try {
      const result = await client.draftTask(id);
      if (this.taskId === id) this.draft = result;
    } catch (err) {
      this.draft = { status: 'failed', action: null };
      toast(humanError(err));
    } finally {
      this.agentBusy = false;
    }
  }

  async acceptDraft(): Promise<void> {
    const action = this.draft?.action ?? null;
    if (action === null || this.agentBusy) return;
    this.agentBusy = true;
    try {
      await this.flushText();
      await client.sendAgentActionFeedback(action.id, { feedback: 'accepted' });
      this.draft = { status: 'idle', action: null };
      this.titleDirty = false;
      this.notesDirty = false;
      await this.reloadOpenTask();
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.agentBusy = false;
    }
  }

  async dismissDraft(): Promise<void> {
    const action = this.draft?.action ?? null;
    if (action === null || this.agentBusy) return;
    this.agentBusy = true;
    try {
      await client.sendAgentActionFeedback(action.id, { feedback: 'dismissed' });
      this.draft = { status: 'idle', action: null };
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.agentBusy = false;
    }
  }

  async settleDecompose(feedback: 'accepted' | 'dismissed'): Promise<void> {
    const action = this.decompose;
    if (action === null || this.agentBusy) return;
    this.agentBusy = true;
    try {
      await client.sendAgentActionFeedback(action.id, { feedback });
      this.decompose = null;
      if (feedback === 'accepted') await this.reloadOpenTask();
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.agentBusy = false;
    }
  }

  private async reloadOpenTask(): Promise<void> {
    const id = this.taskId;
    if (id === '') return;
    const next = await client.getTask(id);
    if (this.taskId !== id) return;
    this.titleDirty = false;
    this.notesDirty = false;
    this.applyTask(next);
    await this.reloadSubtasks();
    await this.loadContext();
  }

  hintSubtasksHalf(): void {
    toast(copy.todos.subtasksHintFull);
  }
}
