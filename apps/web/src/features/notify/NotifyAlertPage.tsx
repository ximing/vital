import { useEffect, useState } from 'react';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import {
  dismissStickyAlertWindow,
  listenStickyAlerts,
  openStickyAlertTarget,
  parseStickyAlertHash,
  type StickyAlertPayload,
} from './sticky-alert';

function enqueue(queue: StickyAlertPayload[], next: StickyAlertPayload): StickyAlertPayload[] {
  if (queue.some((item) => item.id === next.id)) return queue;
  return [...queue, next];
}

export function NotifyAlertPage({
  closeWindow = dismissStickyAlertWindow,
  openTarget = openStickyAlertTarget,
}: {
  closeWindow?: () => Promise<void> | void;
  openTarget?: (url: string) => Promise<void> | void;
} = {}) {
  const copy = t.settings.notify;
  const [queue, setQueue] = useState<StickyAlertPayload[]>(() => {
    const first = parseStickyAlertHash(window.location.hash);
    return first ? [first] : [];
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
    return <div className="h-screen bg-elevated" data-region="notify-alert" />;
  }

  return (
    <div
      className="flex h-screen flex-col bg-elevated px-5 py-4 text-fg"
      data-region="notify-alert"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="notify-alert-title"
      aria-describedby="notify-alert-body"
    >
      <p className="text-[length:var(--text-caption)] font-medium leading-[var(--text-caption-lh)] tracking-[0.14em] text-accent uppercase">
        {t.brand.name}
      </p>
      <h1
        id="notify-alert-title"
        className="mt-2 text-[length:var(--text-section)] leading-[var(--text-section-lh)] font-medium"
      >
        {current.title}
      </h1>
      <p
        id="notify-alert-body"
        className="mt-1 line-clamp-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-secondary"
      >
        {current.body}
      </p>
      {remaining > 0 ? (
        <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
          {copy.remaining.replace('{n}', String(remaining))}
        </p>
      ) : null}
      <div className="mt-auto flex justify-end gap-2 pt-4">
        <Button variant="quiet" onClick={later}>
          {copy.later}
        </Button>
        <Button onClick={open}>{copy.open}</Button>
      </div>
    </div>
  );
}
