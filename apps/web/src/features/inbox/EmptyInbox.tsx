import { Plus } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { PASTE_URL_ID } from './model';
import { useInboxUi } from './inbox-ui.service';

export function EmptyInbox() {
  const requestPaste = useInboxUi((s) => s.requestPaste);
  const [hint, setHint] = useState(false);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
      <p className="eyebrow eyebrow-accent">
        {t.rail.capture} · 0
      </p>
      <h2 className="mt-4 max-w-[24ch] font-display text-[24px] font-semibold leading-[32px] tracking-[-0.02em] text-fg">
        {t.empty.inboxTitle}
      </h2>
      <p className="mt-3 max-w-[42ch] text-[length:var(--text-meta)] leading-[1.7] text-muted">
        {t.empty.inboxHint}
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            requestPaste();
            document.getElementById(PASTE_URL_ID)?.focus();
          }}
        >
          <Icon icon={Plus} size={14} className="mr-1" />
          {t.inbox.pasteUrl}
        </Button>
        <Button variant="quiet" onClick={() => setHint(true)}>
          {t.empty.actionExtension}
        </Button>
      </div>
      {hint ? (
        <p
          role="status"
          className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
        >
          {t.inbox.installHint}
        </p>
      ) : null}
      <p className="mt-8 font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
        {t.empty.inboxKbd}
      </p>
    </div>
  );
}

export function EmptyReader() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <p className="eyebrow">{t.rail.capture}</p>
      <p className="mt-3 max-w-md text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
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
