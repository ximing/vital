import { Service } from '@rabjs/react';
import type { InboxItem, Outcome, OutcomeDetail, OutcomeMaterial, Task } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { pullSync, subscribeSync } from '../../lib/sync';
import { toggleComplete } from '../todos/complete';

const SYNC_DEBOUNCE_MS = 500;

export class ThreadsService extends Service {
  open: Outcome[] = [];
  closed: Outcome[] = [];
  loading = true;
  refreshing = false;
  error: string | null = null;
  creating = false;
  newName = '';
  renaming: Outcome | null = null;
  renameName = '';
  saving = false;
  menuOutcome: Outcome | null = null;

  private inFlight: Promise<void> | null = null;
  private hasData = false;
  private unsubSync: (() => void) | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.unsubSync) return;
    this.unsubSync = subscribeSync(() => {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => void this.load(false), SYNC_DEBOUNCE_MS);
    });
  }

  stop(): void {
    this.unsubSync?.();
    this.unsubSync = null;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
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
        const [nextOpen, nextClosed] = await Promise.all([
          client.listOutcomes('open'),
          client.listOutcomes('closed'),
        ]);
        this.open = nextOpen;
        this.closed = nextClosed;
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

  async runAction(work: () => Promise<void>): Promise<void> {
    try {
      await work();
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    }
  }

  openCreate(): void {
    this.newName = '';
    this.creating = true;
  }

  closeCreate(): void {
    this.creating = false;
    this.newName = '';
  }

  setNewName(name: string): void {
    this.newName = name;
  }

  openRename(outcome: Outcome): void {
    this.renaming = outcome;
    this.renameName = outcome.name;
    this.menuOutcome = null;
  }

  closeRename(): void {
    this.renaming = null;
    this.renameName = '';
  }

  setRenameName(name: string): void {
    this.renameName = name;
  }

  openMenu(outcome: Outcome): void {
    this.menuOutcome = outcome;
  }

  closeMenu(): void {
    this.menuOutcome = null;
  }

  async submitCreate(): Promise<void> {
    const name = this.newName.trim();
    if (name === '' || this.saving) return;
    this.saving = true;
    try {
      await client.createOutcome({ name });
      this.newName = '';
      this.creating = false;
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.saving = false;
    }
  }

  async submitRename(): Promise<void> {
    if (this.renaming === null || this.saving) return;
    const name = this.renameName.trim();
    if (name === '' || name === this.renaming.name) {
      this.closeRename();
      return;
    }
    this.saving = true;
    try {
      await client.patchOutcome(this.renaming.id, { name });
      this.closeRename();
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.saving = false;
    }
  }

  async close(outcome: Outcome): Promise<void> {
    this.closeMenu();
    await this.runAction(() => client.closeOutcome(outcome.id).then(() => undefined));
  }

  async reopen(outcome: Outcome): Promise<void> {
    this.closeMenu();
    await this.runAction(() => client.reopenOutcome(outcome.id).then(() => undefined));
  }
}

const ATTACH_PAGE_LIMIT = 50;

export class ThreadDetailService extends Service {
  outcomeId = '';
  detail: OutcomeDetail | null = null;
  loading = true;
  error: string | null = null;
  menuOpen = false;
  renaming = false;
  renameName = '';
  creatingTask = false;
  newTaskTitle = '';
  busy = false;
  attaching = false;
  attachSearch = '';
  attachItems: InboxItem[] | null = null;
  outcomeNames: Record<string, string> = {};
  menuMaterial: OutcomeMaterial | null = null;

  private inFlight: Promise<void> | null = null;
  private hasData = false;
  private unsubSync: (() => void) | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  get openTasks(): Task[] {
    return (this.detail?.tasks ?? []).filter((task) => task.status === 'todo' || task.status === 'doing');
  }

  get doneTasks(): Task[] {
    return (this.detail?.tasks ?? [])
      .filter((task) => task.status === 'done')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }

  get attachCandidates(): InboxItem[] {
    if (this.detail === null || this.attachItems === null) return [];
    const attached = new Set(this.detail.materials.map((material) => material.id));
    const term = this.attachSearch.trim();
    return this.attachItems.filter(
      (item) =>
        item.status !== 'converted' &&
        !attached.has(item.id) &&
        (term === '' || item.title.includes(term)),
    );
  }

  configure(outcomeId: string): void {
    if (this.outcomeId !== outcomeId) {
      this.outcomeId = outcomeId;
      this.detail = null;
      this.hasData = false;
      this.loading = true;
      this.error = null;
    }
    this.start();
  }

  start(): void {
    if (this.unsubSync) return;
    this.unsubSync = subscribeSync(() => {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => void this.load(false), SYNC_DEBOUNCE_MS);
    });
  }

  stop(): void {
    this.unsubSync?.();
    this.unsubSync = null;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async load(initial: boolean): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    const run = (async () => {
      if (initial && !this.hasData) this.loading = true;
      try {
        this.detail = await client.getOutcomeDetail(this.outcomeId);
        this.hasData = true;
        this.error = null;
      } catch (err) {
        this.error = humanError(err);
      } finally {
        this.loading = false;
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
    await this.load(true);
  }

  async runAction(work: () => Promise<void>): Promise<void> {
    try {
      await work();
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    }
  }

  applyTask(next: Task): void {
    const prev = this.detail;
    if (prev === null) return;
    const idx = prev.tasks.findIndex((row) => row.id === next.id);
    if (idx < 0) return;
    const tasks = [...prev.tasks];
    tasks[idx] = next;
    this.detail = { ...prev, tasks };
  }

  toggleTask(task: Task): void {
    if (task.status === 'done') {
      void this.runAction(() => client.patchTask(task.id, { status: 'todo' }).then(() => undefined));
      return;
    }
    void toggleComplete(task, (next) => this.applyTask(next)).then(() => this.load(false));
  }

  openMenu(): void {
    this.menuOpen = true;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  openRename(): void {
    if (this.detail === null) return;
    this.renameName = this.detail.outcome.name;
    this.renaming = true;
    this.menuOpen = false;
  }

  closeRename(): void {
    this.renaming = false;
  }

  setRenameName(name: string): void {
    this.renameName = name;
  }

  toggleCreatingTask(): void {
    this.newTaskTitle = '';
    this.creatingTask = !this.creatingTask;
  }

  closeCreatingTask(): void {
    this.creatingTask = false;
  }

  setNewTaskTitle(title: string): void {
    this.newTaskTitle = title;
  }

  openMaterialMenu(material: OutcomeMaterial): void {
    this.menuMaterial = material;
  }

  closeMaterialMenu(): void {
    this.menuMaterial = null;
  }

  setAttachSearch(value: string): void {
    this.attachSearch = value;
  }

  closeAttach(): void {
    this.attaching = false;
  }

  async submitRename(): Promise<void> {
    if (this.detail === null || this.busy) return;
    const name = this.renameName.trim();
    if (name === '' || name === this.detail.outcome.name) {
      this.renaming = false;
      return;
    }
    this.busy = true;
    try {
      await client.patchOutcome(this.detail.outcome.id, { name });
      this.renaming = false;
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.busy = false;
    }
  }

  async submitNewTask(): Promise<void> {
    if (this.detail === null || this.busy) return;
    const title = this.newTaskTitle.trim();
    if (title === '') return;
    this.busy = true;
    try {
      const listId =
        this.detail.tasks[0]?.listId ??
        (await client.listLists().then((res) => res.items.find((row) => row.kind === 'inbox')?.id));
      if (!listId) throw new Error('no list');
      await client.createTask({ title, listId, outcomeId: this.detail.outcome.id });
      this.newTaskTitle = '';
      this.creatingTask = false;
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.busy = false;
    }
  }

  async openAttach(): Promise<void> {
    this.attachSearch = '';
    this.attachItems = null;
    this.attaching = true;
    try {
      const [page, outcomes] = await Promise.all([client.listInbox({ limit: ATTACH_PAGE_LIMIT }), client.listOutcomes()]);
      this.attachItems = page.items.filter((row) => row.deletedAt === null);
      const names: Record<string, string> = {};
      for (const outcome of outcomes) names[outcome.id] = outcome.name;
      this.outcomeNames = names;
    } catch (err) {
      this.attaching = false;
      toast(humanError(err));
    }
  }

  async attach(item: InboxItem): Promise<void> {
    const outcome = this.detail?.outcome;
    if (!outcome) return;
    this.attaching = false;
    await this.runAction(() => client.patchInbox(item.id, { outcomeId: outcome.id }).then(() => undefined));
  }

  async detach(material: OutcomeMaterial): Promise<void> {
    this.menuMaterial = null;
    await this.runAction(() => client.patchInbox(material.id, { outcomeId: null }).then(() => undefined));
  }

  async closeOutcome(): Promise<void> {
    const outcome = this.detail?.outcome;
    if (!outcome) return;
    this.menuOpen = false;
    await this.runAction(() => client.closeOutcome(outcome.id).then(() => undefined));
  }

  async reopenOutcome(): Promise<void> {
    const outcome = this.detail?.outcome;
    if (!outcome) return;
    this.menuOpen = false;
    await this.runAction(() => client.reopenOutcome(outcome.id).then(() => undefined));
  }
}
