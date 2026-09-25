import { Service } from '@rabjs/react';
import type { AgentMemoryItem, AgentMemoryKind, AgentMemoryScopeValue } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { pullSync } from '../../lib/sync';

const KIND_ORDER: AgentMemoryKind[] = ['preference', 'pattern', 'correction'];

export function toggleMemoryScope(current: string[], value: string): string[] {
  if (value === 'all') return ['all'];
  const rest = current.filter((item) => item !== 'all');
  const next = rest.includes(value) ? rest.filter((item) => item !== value) : [...rest, value];
  return next.length === 0 ? ['all'] : next;
}

export class MemoryService extends Service {
  items: AgentMemoryItem[] = [];
  loading = true;
  refreshing = false;
  error: string | null = null;
  menuOpen = false;
  menuItem: AgentMemoryItem | null = null;
  distilling = false;
  draft: { mode: 'create' } | { mode: 'edit'; id: string } | null = null;
  draftKind: AgentMemoryKind = 'preference';
  draftContent = '';
  draftScope: string[] = ['all'];
  saving = false;

  private inFlight: Promise<void> | null = null;
  private hasData = false;

  get sorted(): AgentMemoryItem[] {
    return [...this.items].sort((a, b) => {
      const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      if (byKind !== 0) return byKind;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
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
        this.items = await client.listAgentMemory();
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

  openPageMenu(): void {
    this.menuOpen = true;
  }

  closePageMenu(): void {
    this.menuOpen = false;
  }

  openMenu(item: AgentMemoryItem): void {
    this.menuItem = item;
  }

  closeMenu(): void {
    this.menuItem = null;
  }

  openCreate(): void {
    this.menuOpen = false;
    this.draft = { mode: 'create' };
    this.draftKind = 'preference';
    this.draftContent = '';
    this.draftScope = ['all'];
  }

  openEdit(item: AgentMemoryItem): void {
    this.menuItem = null;
    this.draft = { mode: 'edit', id: item.id };
    this.draftKind = item.kind;
    this.draftContent = item.content;
    this.draftScope = item.scope.length > 0 ? [...item.scope] : ['all'];
  }

  closeDraft(): void {
    this.draft = null;
  }

  setDraftKind(kind: AgentMemoryKind): void {
    this.draftKind = kind;
  }

  setDraftContent(content: string): void {
    this.draftContent = content;
  }

  toggleDraftScope(value: string): void {
    this.draftScope = toggleMemoryScope(this.draftScope, value);
  }

  async saveDraft(): Promise<void> {
    const content = this.draftContent.trim();
    if (this.draft === null || content === '' || this.saving) return;
    const scope = this.draftScope as AgentMemoryScopeValue[];
    this.saving = true;
    try {
      if (this.draft.mode === 'create') {
        await client.createAgentMemory({ kind: this.draftKind, content, scope });
      } else {
        await client.patchAgentMemory(this.draft.id, { kind: this.draftKind, content, scope });
      }
      this.draft = null;
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.saving = false;
    }
  }

  async distill(): Promise<void> {
    if (this.distilling) return;
    this.distilling = true;
    try {
      const res = await client.distillAgentMemory();
      toast(res.status === 'queued' ? copy.memory.distillQueued : copy.memory.distillDisabled);
    } catch (err) {
      toast(humanError(err));
    } finally {
      this.distilling = false;
    }
  }

  async remove(item: AgentMemoryItem): Promise<void> {
    try {
      await client.deleteAgentMemory(item.id);
      await this.load(false);
      this.closeMenu();
    } catch (err) {
      toast(humanError(err));
    }
  }
}
