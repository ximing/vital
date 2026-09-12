import { Service } from '@rabjs/react';
import type { AgentMemoryItem, AgentMemoryKind } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { pullSync } from '../../lib/sync';

const KIND_ORDER: AgentMemoryKind[] = ['preference', 'pattern', 'correction'];

export class MemoryService extends Service {
  items: AgentMemoryItem[] = [];
  loading = true;
  refreshing = false;
  error: string | null = null;
  menuOpen = false;
  menuItem: AgentMemoryItem | null = null;
  distilling = false;

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
