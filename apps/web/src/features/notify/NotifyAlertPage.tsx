import { Bell, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import {
  dismissStickyAlertWindow,
  listenStickyAlerts,
  openStickyAlertTarget,
  parseStickyAlertHash,
  type StickyAlertPayload,
} from './sticky-alert';

type QueuedAlert = StickyAlertPayload & { at: number };

function enqueue(queue: QueuedAlert[], next: StickyAlertPayload): QueuedAlert[] {
  if (queue.some((item) => item.id === next.id)) return queue;
  return [...queue, { ...next, at: Date.now() }];
}

function hm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Queue progress dots: current lit, the rest dim; capped so a long queue stays tidy. */
function QueueDots({ total }: { total: number }) {
  const shown = Math.min(Math.max(total, 1), 4);
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: shown }, (_, i) => (
        <i
          key={i}
          className={`size-1.5 rounded-full ${i === 0 ? 'bg-accent' : 'bg-surface-muted'}`}
        />
      ))}
    </span>
  );
}

export function NotifyAlertPage({
  closeWindow = dismissStickyAlertWindow,
  openTarget = openStickyAlertTarget,
}: {
  closeWindow?: () => Promise<void> | void;
  openTarget?: (url: string) => Promise<void> | void;
} = {}) {
  const copy = t.settings.notify;
  const [queue, setQueue] = useState<QueuedAlert[]>(() => {
    const first = parseStickyAlertHash(window.location.hash);
    return first ? [{ ...first, at: Date.now() }] : [];
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listenStickyAlerts((item) => {
      if (!cancelled) setQueue((current) => enqueue(current, item));
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // The window is transparent so the rounded card corners show the desktop
  // through; keep every backdrop layer clear of the app body background.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  const current = queue[0];
  const remaining = queue.length - 1;

  useEffect(() => {
    if (current) document.title = current.title;
  }, [current]);

  function later(): void {
    if (queue.length <= 1) {
      setQueue([]);
      void closeWindow();
      return;
    }
    setQueue(queue.slice(1));
  }

  function open(): void {
    if (!current) return;
    const url = current.url;
    void Promise.resolve(openTarget(url)).finally(() => later());
  }

  if (!current) {
    return <div className="h-screen" data-region="notify-alert" />;
  }

  return (
    <div
      className="notify-alert-enter relative flex h-screen flex-col overflow-hidden rounded-[14px] bg-elevated px-4 pb-3 pt-[14px] text-fg"
      data-region="notify-alert"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="notify-alert-title"
      aria-describedby="notify-alert-body"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] opacity-90 [background:linear-gradient(90deg,var(--accent-primary),transparent_72%)]"
      />
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-accent-subtle text-accent-deep">
          <Icon icon={Bell} size={12} strokeWidth={2.2} />
        </span>
        <span className="text-[11px] font-semibold uppercase leading-4 tracking-[0.12em] text-accent-deep">
          {t.brand.name} · {copy.kind}
        </span>
        <span className="ml-auto text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] tabular-nums text-tertiary">
          {hm(current.at)}
        </span>
        <button
          type="button"
          aria-label={copy.close}
          className="grid size-6 shrink-0 place-items-center rounded-md text-tertiary transition-colors duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          onClick={later}
        >
          <Icon icon={X} size={12} strokeWidth={2.2} />
        </button>
      </div>
      <h1
        id="notify-alert-title"
        className="shrink-0 truncate font-display text-[length:var(--text-section)] leading-[var(--text-section-lh)] font-semibold"
      >
        {current.title}
      </h1>
      <p
        id="notify-alert-body"
        className="mt-1 line-clamp-2 min-h-0 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-secondary"
      >
        {current.body}
      </p>
      <div className="mt-auto flex shrink-0 items-center gap-3 pt-2.5">
        {remaining > 0 ? (
          <span className="flex items-center gap-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
            <QueueDots total={queue.length} />
            {copy.remaining.replace('{n}', String(remaining))}
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="quiet" size="sm" onClick={later}>
            {copy.later}
          </Button>
          <Button size="sm" className="font-semibold" onClick={open}>
            {copy.open}
          </Button>
        </div>
      </div>
    </div>
  );
}
