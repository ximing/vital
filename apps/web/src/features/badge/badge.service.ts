import { resolve, Service } from '@rabjs/react';
import { client } from '@/api/client';
import { getVitalHost } from '@/host';
import { todoKeys } from '@/features/todos/query-keys';
import { AuthService } from '@/services/auth.service';
import { appQueryClient } from '@/services/query.service';
import { renderBadgeOverlay } from './badge-icon';

const DEBOUNCE_MS = 300;
const FALLBACK_MS = 60_000;
const COUNTS_STALE_MS = 30_000;
const RETRY_BASE_MS = 5_000;

type CountMap = Record<string, number>;

/**
 * Dock / taskbar badge for today's open tasks (`smart:today`).
 * Shares the sidebar counts cache. A missing host (browser) is a no-op.
 */
export class BadgeService extends Service {
  private started = false;
  private epoch = 0;
  private last = -1;
  private failures = 0;
  private holdUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // Drop a refresh that began before this session.
    this.epoch += 1;
    this.unsubscribe = appQueryClient.getQueryCache().subscribe((event) => {
      const head = event.query.queryKey[0];
      if (head !== 'todos' && head !== 'today') return;
      this.schedule();
    });
    this.interval = setInterval(() => {
      void this.refresh();
    }, FALLBACK_MS);
    void this.refresh();
  }

  stop(): void {
    this.started = false;
    this.epoch += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.failures = 0;
    this.holdUntil = 0;
    this.last = -1;
    getVitalHost()?.setBadge?.(0);
  }

  private schedule(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, DEBOUNCE_MS);
  }

  private async refresh(): Promise<void> {
    if (!this.started) return;
    const epoch = this.epoch;
    if (!this.auth.user) {
      this.apply(0);
      return;
    }
    // A failed counts fetch is marked invalidated, so fetchQuery would ignore staleTime and loop.
    if (Date.now() < this.holdUntil) {
      this.applyCached();
      return;
    }
    const state = appQueryClient.getQueryState<CountMap>(todoKeys.counts);
    const cached = state?.data;
    const fresh =
      cached !== undefined &&
      !state?.isInvalidated &&
      Date.now() - (state?.dataUpdatedAt ?? 0) < COUNTS_STALE_MS;
    if (fresh && cached) {
      this.apply(cached['smart:today'] ?? 0);
      return;
    }
    try {
      // Direct call so a refresh that outlives stop/start cannot resolve through a shared fetchQuery.
      const counts = (await client.taskCounts()).counts;
      if (!this.started || epoch !== this.epoch) return;
      this.failures = 0;
      this.holdUntil = 0;
      appQueryClient.setQueryData(todoKeys.counts, counts);
      this.apply(counts['smart:today'] ?? 0);
    } catch {
      if (!this.started || epoch !== this.epoch) return;
      this.failures += 1;
      const delay = Math.min(FALLBACK_MS, RETRY_BASE_MS * 2 ** (this.failures - 1));
      this.holdUntil = Date.now() + delay;
    }
  }

  private applyCached(): void {
    const cached = appQueryClient.getQueryData<CountMap>(todoKeys.counts);
    if (!cached) return;
    this.apply(cached['smart:today'] ?? 0);
  }

  private apply(count: number): void {
    if (count === this.last) return;
    const png = count > 0 ? renderBadgeOverlay(count) : '';
    this.last = count;
    getVitalHost()?.setBadge?.(count, png === '' ? undefined : png);
  }
}

export function badgeService(): BadgeService {
  return resolve(BadgeService);
}
