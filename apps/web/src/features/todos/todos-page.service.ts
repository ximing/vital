import { Service } from '@rabjs/react';
import { llmReady, SMART_LIST_IDS, type SmartListId, type Task } from '@vital/dto';
import { client } from '@/api/client';
import { markOnboarding } from '@/features/onboarding/mark';
import { AuthService } from '@/services/auth.service';
import { QueryService } from '@/services/query.service';
import { createPayload, overdueDueAtForToday, todayYmd } from './model';
import type { ComposeExtras } from './QuickAdd';
import { todoKeys } from './queries';
import { applyDraftToCreate, type ScheduleDraft } from './schedule-draft';
import { TodosUiService } from './todos-ui.service';

export type TaskMenu = { task: Task; x: number; y: number };

export class TodosPageService extends Service {
  weekAnchor = todayYmd('UTC');
  composeDay: string | null = null;
  taskMenu: TaskMenu | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get todos(): TodosUiService {
    return this.resolve(TodosUiService);
  }

  get query(): QueryService {
    return this.resolve(QueryService);
  }

  get timeZone(): string {
    return this.auth.user?.timezone ?? 'UTC';
  }

  get weekStartsOn(): 0 | 1 {
    return this.auth.user?.weekStartsOn === 0 ? 0 : 1;
  }

  setWeekAnchor(ymd: string): void {
    this.weekAnchor = ymd;
    this.composeDay = null;
  }

  setComposeDay(ymd: string | null): void {
    this.composeDay = ymd;
  }

  openTaskMenu(task: Task, x: number, y: number): void {
    this.taskMenu = { task, x, y };
  }

  closeTaskMenu(): void {
    this.taskMenu = null;
  }

  async invalidateTasks(): Promise<void> {
    await this.query.invalidate(todoKeys.all);
  }

  postponeOverdue(overdue: Task[]): void {
    const today = todayYmd(this.timeZone);
    for (const task of overdue) {
      const dueAt = overdueDueAtForToday(task, today, this.timeZone);
      if (dueAt === null) continue;
      void client.patchTask(task.id, { dueAt }).then(() => this.invalidateTasks());
    }
  }

  async create(
    name: string,
    draft: ScheduleDraft,
    extras: ComposeExtras,
    listId: string,
    inboxId: string,
  ): Promise<void> {
    const timeZone = this.timeZone;
    const intent = llmReady(this.auth.user?.llm, 'task.parse');
    if (intent) {
      const task = await client.createTaskFromText({
        text: name,
        listId: extras.listId || inboxId,
        timezone: timeZone,
        ...((SMART_LIST_IDS as readonly string[]).includes(listId)
          ? { smartListId: listId as SmartListId }
          : {}),
        ...(extras.status !== undefined ? { status: extras.status } : {}),
        ...(extras.priority !== undefined ? { priority: extras.priority } : {}),
        ...(this.composeDay ? { dueYmd: this.composeDay } : {}),
      });
      this.query.client.setQueryData(todoKeys.item(task.id), task);
      await this.invalidateTasks();
      await markOnboarding({ createdTask: true });
      this.todos.setSelected(task.id);
      this.todos.openDetail(task.id);
      this.composeDay = null;
      return;
    }
    const base = createPayload(name, listId, inboxId, timeZone, new Date(), this.composeDay ?? undefined);
    const next = applyDraftToCreate(base, draft, timeZone);
    if (extras.listId) next.listId = extras.listId;
    if (extras.priority !== undefined && extras.priority !== 3) next.priority = extras.priority;
    if (extras.status) next.status = extras.status;
    const task = await client.createTask(next);
    this.query.client.setQueryData(todoKeys.item(task.id), task);
    await this.invalidateTasks();
    await markOnboarding({ createdTask: true });
    this.todos.setSelected(task.id);
    this.composeDay = null;
  }
}
