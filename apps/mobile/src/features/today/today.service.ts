import { AppState, type AppStateStatus } from 'react-native';
import { Service } from '@rabjs/react';
import type {
  AgentActionLogItem,
  AgentExecution,
  CreateHabitInput,
  Habit,
  List,
  Tag,
  Task,
  TodayDashboard,
} from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { humanError, isNetworkError } from '../../lib/errors';
import { isOverdue } from '../../lib/format';
import { pullSync, subscribeSync } from '../../lib/sync';
import { AuthService } from '../../services/auth.service';
import { toggleComplete } from '../todos/complete';
import { postponeDueAt } from './model';

const SYNC_DEBOUNCE_MS = 500;
const EXEC_POLL_MS = 15_000;

export class TodayService extends Service {
  dashboard: TodayDashboard | null = null;
  habits: Habit[] = [];
  lists: List[] = [];
  tags: Tag[] = [];
  proposals: AgentActionLogItem[] = [];
  executions: AgentExecution[] = [];
  settleBusyId: string | null = null;
  loading = true;
  refreshing = false;
  error: string | null = null;
  offline = false;

  private inFlight: Promise<void> | null = null;
  private hasData = false;
  private unsubSync: (() => void) | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private execTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get activeHabits(): Habit[] {
    return this.habits.filter((habit) => habit.active);
  }

  get inboxId(): string | undefined {
    return this.lists.find((row) => row.kind === 'inbox')?.id;
  }

  get agentRunningCount(): number {
    return this.executions.filter((item) => item.status === 'running').length;
  }

  get agentFailedCount(): number {
    return this.executions.filter((item) => item.status === 'failed').length;
  }

  start(): void {
    if (this.unsubSync) return;
    this.unsubSync = subscribeSync((changes) => {
      if (changes.tasks.length === 0 && changes.inbox.length === 0 && changes.reports.length === 0) {
        return;
      }
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        void this.load(false);
      }, SYNC_DEBOUNCE_MS);
    });
    this.startExecPoll();
  }

  stop(): void {
    this.unsubSync?.();
    this.unsubSync = null;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.stopExecPoll();
  }

  private startExecPoll(): void {
    if (this.appStateSub) return;
    const tick = async (): Promise<void> => {
      try {
        this.executions = await client.listAgentExecutions(1);
      } catch {
        // Pulse is best-effort.
      }
    };
    const onState = (state: AppStateStatus): void => {
      if (state === 'active') {
        void tick();
        if (this.execTimer === null) this.execTimer = setInterval(() => void tick(), EXEC_POLL_MS);
        return;
      }
      if (this.execTimer) {
        clearInterval(this.execTimer);
        this.execTimer = null;
      }
    };
    onState(AppState.currentState);
    this.appStateSub = AppState.addEventListener('change', onState);
  }

  private stopExecPoll(): void {
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.execTimer) {
      clearInterval(this.execTimer);
      this.execTimer = null;
    }
  }

  async load(isRefresh = false): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    const run = (async () => {
      if (isRefresh) this.refreshing = true;
      else if (!this.hasData) this.loading = true;
      try {
        const [nextDashboard, nextHabits, listRes, tagRes, actions] = await Promise.all([
          client.getToday(),
          client.listHabits(),
          client.listLists(),
          client.listTags(),
          client.listAgentActions({ days: 7 }),
        ]);
        this.dashboard = nextDashboard;
        this.habits = nextHabits;
        this.lists = listRes.items;
        this.tags = tagRes.items;
        this.proposals = actions.filter((item) => item.feedback === 'pending');
        this.hasData = true;
        this.error = null;
        this.offline = false;
      } catch (err) {
        this.error = humanError(err);
        this.offline = isNetworkError(err);
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

  async refresh(): Promise<void> {
    await this.load(true);
  }

  async reloadFromFocus(): Promise<void> {
    await pullSync().catch(() => null);
    await this.load(false);
  }

  applyTask(next: Task): void {
    const prev = this.dashboard;
    if (!prev) return;
    const idx = prev.tasks.findIndex((row) => row.id === next.id);
    const tasks = idx < 0 ? [next, ...prev.tasks] : prev.tasks.map((row, i) => (i === idx ? next : row));
    this.dashboard = { ...prev, tasks };
  }

  private async runAction(work: () => Promise<void>): Promise<void> {
    try {
      await work();
      await this.refresh();
    } catch (err) {
      toast(humanError(err));
    }
  }

  async completeTask(task: Task): Promise<void> {
    let ok = false;
    await toggleComplete(
      task,
      (next) => {
        this.applyTask(next);
        ok = true;
      },
      { user: this.auth.user, refreshUser: (next) => this.auth.refreshUser(next) },
    );
    if (ok) await this.refresh();
  }

  async postponeOverdue(): Promise<void> {
    const tz = this.auth.user?.timezone ?? 'UTC';
    const overdue = (this.dashboard?.tasks ?? []).filter((task) => isOverdue(task));
    if (overdue.length === 0) return;
    await this.runAction(async () => {
      await Promise.all(
        overdue.map((task) => {
          const dueAt = postponeDueAt(task, tz);
          if (dueAt === null) return Promise.resolve();
          return client.patchTask(task.id, { dueAt }).then((next) => this.applyTask(next));
        }),
      );
    });
  }

  async createOutcome(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '') return;
    await this.runAction(async () => {
      await client.createOutcome({ name: trimmed });
    });
  }

  async undoOutcome(id: string): Promise<void> {
    await this.runAction(async () => {
      await client.undoOutcome(id);
    });
  }

  async refreshOutcome(id: string): Promise<void> {
    await this.runAction(async () => {
      await client.refreshOutcome(id);
    });
  }

  async closeOutcome(id: string): Promise<void> {
    await this.runAction(async () => {
      await client.closeOutcome(id);
    });
  }

  async reopenOutcome(id: string): Promise<void> {
    await this.runAction(async () => {
      await client.reopenOutcome(id);
    });
  }

  async enableHabit(input: CreateHabitInput): Promise<void> {
    await this.runAction(async () => {
      await client.createHabit(input);
    });
  }

  async settleProposal(id: string, feedback: 'accepted' | 'dismissed'): Promise<void> {
    if (this.settleBusyId !== null) return;
    this.settleBusyId = id;
    try {
      await this.runAction(async () => {
        await client.sendAgentActionFeedback(id, { feedback });
      });
    } finally {
      this.settleBusyId = null;
    }
  }
}
