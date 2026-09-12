import { Service } from '@rabjs/react';
import { QueryService } from '@/services/query.service';
import { todoKeys } from '@/features/todos/queries';
import { todayKeys } from './queries';

export class ThreadPageService extends Service {
  now = new Date();
  creatingTask = false;

  get query(): QueryService {
    return this.resolve(QueryService);
  }

  startCreate(): void {
    this.creatingTask = true;
  }

  cancelCreate(): void {
    this.creatingTask = false;
  }

  setCreating(value: boolean): void {
    this.creatingTask = value;
  }

  async refresh(): Promise<void> {
    await this.query.invalidate(todayKeys.all);
    await this.query.invalidate(todoKeys.all);
  }
}
