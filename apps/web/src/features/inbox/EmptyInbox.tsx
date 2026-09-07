import { useState } from 'react';
import { t } from '@/copy';
import { EmptyArt } from '@/ui/empty-art';
import { PASTE_URL_ID } from './model';
import { useInboxUi } from './inbox-ui.service';

export function EmptyInbox() {
  const requestPaste = useInboxUi((s) => s.requestPaste);
  const [hint, setHint] = useState(false);

  return (
    <div className="relative flex min-h-full flex-1 flex-col items-center px-3 py-8 text-center">
      <div data-vignette="mineral-garden" aria-hidden="true" className="absolute inset-0" />
      <EmptyArt className="relative z-10" />
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {t.empty.inbox}
      </p>
      <div className="mt-4 flex w-full flex-col gap-2">
        <button
          type="button"
          className="relative z-10 inline-flex min-h-9 w-full items-center justify-center rounded-md px-3 text-[length:var(--text-meta)] text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          onClick={() => setHint(true)}
        >
          {t.empty.actionExtension}
        </button>
        <button
          type="button"
          className="relative z-10 inline-flex min-h-9 w-full items-center justify-center rounded-md px-3 text-[length:var(--text-meta)] text-muted transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          onClick={() => {
            requestPaste();
            document.getElementById(PASTE_URL_ID)?.focus();
          }}
        >
          {t.inbox.pasteUrl}
        </button>
      </div>
      {hint ? (
        <p
          role="status"
          className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
        >
          {t.inbox.installHint}
        </p>
      ) : null}
    </div>
  );
}

export function EmptyReader() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <EmptyArt />
      <p className="max-w-md text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {t.empty.inboxReader}
      </p>
    </div>
  );
}

export function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-3 py-6" aria-busy="true" aria-label={t.inbox.loading}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton-pulse h-14 rounded-md" />
      ))}
    </div>
  );
}
