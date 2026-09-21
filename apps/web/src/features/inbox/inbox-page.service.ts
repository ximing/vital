import type { ConvertInboxResponse, InboxItem } from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { todoKeys } from '@/features/todos/query-keys';
import { TodosUiService } from '@/features/todos/todos-ui.service';
import { AuthService } from '@/services/auth.service';
import { QueryService } from '@/services/query.service';
import { inboxKeys } from './queries';

export type InboxItemMenu = { item: InboxItem; x: number; y: number };

export class InboxPageService extends Service {
  itemMenu: InboxItemMenu | null = null;
  actionError: string | null = null;
  statusNote: string | null = null;
  exportingId: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get query(): QueryService {
    return this.resolve(QueryService);
  }

  get todos(): TodosUiService {
    return this.resolve(TodosUiService);
  }

  get timeZone(): string {
    return this.auth.user?.timezone ?? 'UTC';
  }

  openItemMenu(item: InboxItem, x: number, y: number): void {
    this.itemMenu = { item, x, y };
  }

  closeItemMenu(): void {
    this.itemMenu = null;
  }

  setActionError(message: string | null): void {
    this.actionError = message;
  }

  setStatusNote(message: string | null): void {
    this.statusNote = message;
  }

  async refresh(): Promise<void> {
    await this.query.invalidate(inboxKeys.all);
  }

  async convertKeepUrl(id: string): Promise<ConvertInboxResponse> {
    this.actionError = null;
    const res = await client.convertInbox(id, {});
    this.todos.noteSimilarOpen(res.similarOpenTasks ?? res.task.similarOpenTasks);
    await this.refresh();
    await this.query.invalidate(todoKeys.all);
    return res;
  }

  async exportToInwit(id: string): Promise<void> {
    if (this.exportingId !== null) return;
    this.actionError = null;
    this.exportingId = id;
    this.setStatusNote(t.inbox.exportingInwit);
    try {
      const res = await client.exportInboxToInwit(id);
      this.query.setQueryData(inboxKeys.item(id), res.inbox);
      this.setStatusNote(t.inbox.exportInwitNote);
      await this.refresh();
    } catch (err) {
      if (this.statusNote === t.inbox.exportingInwit) this.setStatusNote(null);
      throw err;
    } finally {
      this.exportingId = null;
    }
  }

  openConvertedTask(taskId: string): void {
    this.todos.openDetail(taskId);
  }
}
