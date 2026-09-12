import { Service } from '@rabjs/react';
import type { List, PatchTaskInput, Tag, Task } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';
import { toggleComplete } from './complete';

export class TaskSheetService extends Service {
  taskId = '';
  task: Task | null = null;
  lists: List[] = [];
  tags: Tag[] = [];
  title = '';
  notes = '';
  listOpen = false;
  moreOpen = false;
  tagOpen = false;
  subAddToken = 0;
  subtasks: Task[] = [];

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

  configure(taskId: string): void {
    if (this.taskId !== taskId) {
      this.taskId = taskId;
      this.task = null;
      this.title = '';
      this.notes = '';
      this.subtasks = [];
      this.listOpen = false;
      this.moreOpen = false;
      this.tagOpen = false;
      this.subAddToken = 0;
    }
  }

  applyTask(next: Task): void {
    this.task = next;
    this.title = next.title;
    this.notes = next.notes;
  }

  async load(): Promise<void> {
    if (this.taskId === '') return;
    try {
      const [next, listRes, tagRes] = await Promise.all([
        client.getTask(this.taskId),
        client.listLists(),
        client.listTags(),
      ]);
      this.applyTask(next);
      this.lists = listRes.items.filter((row) => row.kind === 'user' || row.kind === 'inbox');
      this.tags = tagRes.items;
      await this.reloadSubtasks();
    } catch (err) {
      toast(humanError(err));
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
      this.subtasks = res.items.filter((item) => item.parentId === parent.id);
    } catch (err) {
      toast(humanError(err));
    }
  }

  setTitle(title: string): void {
    this.title = title;
  }

  setNotes(notes: string): void {
    this.notes = notes;
  }

  openList(): void {
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

  async patch(input: PatchTaskInput): Promise<void> {
    if (this.task === null) return;
    try {
      this.applyTask(await client.patchTask(this.task.id, input));
    } catch (err) {
      toast(humanError(err));
    }
  }

  async saveTitle(): Promise<void> {
    if (this.task === null) return;
    const next = this.title.trim();
    if (next !== '' && next !== this.task.title) await this.patch({ title: next });
    else this.title = this.task.title;
  }

  async saveNotes(): Promise<void> {
    if (this.task === null) return;
    if (this.notes !== this.task.notes) await this.patch({ notes: this.notes });
  }

  async complete(): Promise<void> {
    if (this.task === null) return;
    await toggleComplete(this.task, (next) => this.applyTask(next), {
      user: this.auth.user,
      refreshUser: (next) => this.auth.refreshUser(next),
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
    await this.patch({ listId });
  }

  async toggleTag(tagId: string): Promise<void> {
    if (this.task === null) return;
    const on = this.task.tagIds.includes(tagId);
    const tagIds = on ? this.task.tagIds.filter((id) => id !== tagId) : [...this.task.tagIds, tagId];
    await this.patch({ tagIds });
  }

  async togglePin(): Promise<void> {
    if (this.task === null) return;
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

  hintSubtasksHalf(): void {
    toast(copy.todos.subtasksHintFull);
  }
}
