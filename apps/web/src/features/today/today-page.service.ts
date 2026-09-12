import { Service } from '@rabjs/react';
import { llmReady, type Task } from '@vital/dto';
import { client } from '@/api/client';
import { markOnboarding } from '@/features/onboarding/mark';
import { createPayload, overdueDueAtForToday, todayYmd } from '@/features/todos/model';
import type { ComposeExtras } from '@/features/todos/QuickAdd';
import { todoKeys } from '@/features/todos/queries';
import { applyDraftToCreate, type ScheduleDraft } from '@/features/todos/schedule-draft';
import { TodosUiService } from '@/features/todos/todos-ui.service';
import { AuthService } from '@/services/auth.service';
import { QueryService } from '@/services/query.service';
import { todayKeys } from './queries';

const TODAY_LIST_ID = 'smart:today';

export class TodayPageService extends Service {
  now = new Date();

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

  async refresh(): Promise<void> {
    await this.query.invalidate(todayKeys.all);
    await this.query.invalidate(todoKeys.all);
  }

  postponeOverdue(overdue: Task[]): void {
    const today = todayYmd(this.timeZone);
    for (const task of overdue) {
      const dueAt = overdueDueAtForToday(task, today, this.timeZone);
      if (dueAt === null) continue;
      void client.patchTask(task.id, { dueAt }).then(() => this.refresh());
    }
  }

  async create(name: string, draft: ScheduleDraft, extras: ComposeExtras, inboxId: string): Promise<void> {
    if (inboxId === '') return;
    const timeZone = this.timeZone;
    const intent = llmReady(this.auth.user?.llm, 'task.parse');
    if (intent) {
      const task = await client.createTaskFromText({
        text: name,
        listId: extras.listId || inboxId,
        timezone: timeZone,
        smartListId: TODAY_LIST_ID,
        ...(extras.status !== undefined ? { status: extras.status } : {}),
        ...(extras.priority !== undefined ? { priority: extras.priority } : {}),
      });
      this.query.setQueryData(todoKeys.item(task.id), task);
      await markOnboarding({ createdTask: true });
      this.todos.setSelected(task.id);
      this.todos.openDetail(task.id);
      await this.refresh();
      return;
    }
    const base = createPayload(name, TODAY_LIST_ID, inboxId, timeZone, new Date());
    const next = applyDraftToCreate(base, draft, timeZone);
    if (extras.listId) next.listId = extras.listId;
    if (extras.priority !== undefined && extras.priority !== 3) next.priority = extras.priority;
    if (extras.status) next.status = extras.status;
    const task = await client.createTask(next);
    this.query.setQueryData(todoKeys.item(task.id), task);
    await markOnboarding({ createdTask: true });
    this.todos.setSelected(task.id);
    await this.refresh();
  }
}
