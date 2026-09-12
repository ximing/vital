import { Service } from '@rabjs/react';
import type { AgentActionLogItem, AgentExecution, AgentScheduleItem } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { pullSync } from '../../lib/sync';
import { AuthService } from '../../services/auth.service';

export class ActivityService extends Service {
  actions: AgentActionLogItem[] = [];
  executions: AgentExecution[] = [];
  schedule: AgentScheduleItem[] = [];
  loading = true;
  refreshing = false;
  error: string | null = null;
  busyId: string | null = null;

  private inFlight: Promise<void> | null = null;
  private hasData = false;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get tz(): string {
    return this.auth.user?.timezone ?? 'UTC';
  }

  get sortedActions(): AgentActionLogItem[] {
    const pending = this.actions.filter((item) => item.feedback === 'pending');
    const settled = this.actions.filter((item) => item.feedback !== 'pending');
    return [...pending, ...settled];
  }

  async load(isRefresh: boolean): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    const run = (async () => {
      if (isRefresh) this.refreshing = true;
      else if (!this.hasData) this.loading = true;
      try {
        const [actions, executions, schedule] = await Promise.all([
          client.listAgentActions({ days: 7 }),
          client.listAgentExecutions(7),
          client.listAgentSchedule(),
        ]);
        this.actions = actions;
        this.executions = executions;
        this.schedule = schedule.items;
        this.hasData = true;
        this.error = null;
      } catch (err) {
        this.error = humanError(err);
      } finally {
        this.loading = false;
        this.refreshing = false;
      }
    })();
    this.inFlight = run;
    try {
      await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  async reloadFromFocus(): Promise<void> {
    await pullSync().catch(() => null);
    await this.load(false);
  }

  async sendFeedback(id: string, feedback: 'accepted' | 'dismissed'): Promise<void> {
    if (this.busyId !== null) return;
    this.busyId = id;
    try {
      await client.sendAgentActionFeedback(id, { feedback });
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.busyId = null;
    }
  }

  async runNow(item: AgentScheduleItem): Promise<void> {
    try {
      const res =
        item.capability === 'outcome.cluster'
          ? await client.organizeAgentTasks()
          : await client.distillAgentMemory();
      toast(res.status === 'queued' ? copy.activity.queued : copy.reports.generateDisabled);
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async cancelPending(item: AgentScheduleItem): Promise<void> {
    try {
      await client.cancelAgentSchedule(item.capability);
      toast(copy.activity.cancelled);
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    }
  }
}
