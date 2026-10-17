import { observer, useService } from '@rabjs/react';
import { createPortal } from 'react-dom';
import type { FC } from 'react';
import { Link } from 'react-router';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import { Overlay } from '@/ui/overlay';
import { BrowserNotifyService } from './browser-notify.service';

/** Visible without browser Notification permission. The link is an app path, so the click keeps the page host. */
export const InAppNotice: FC = observer(function InAppNotice() {
  const notify = useService(BrowserNotifyService);
  const notice = notify.inApp;
  if (!notice) return null;
  const copy = t.settings.notify;
  return createPortal(
    <Overlay
      tone="scrim"
      align="center"
      className="px-4"
      onClose={() => notify.dismissInApp()}
      closeOnEscape
      lockFocus
      restoreFocus
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="in-app-notice-title"
        aria-describedby="in-app-notice-body"
        className="w-full max-w-[440px] rounded-xl border border-border bg-elevated p-6 shadow-[var(--shadow)]"
      >
        <h2
          id="in-app-notice-title"
          className="font-display text-[length:var(--text-section)] font-semibold"
        >
          {notice.title}
        </h2>
        <p
          id="in-app-notice-body"
          className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
        >
          {notice.body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => notify.dismissInApp()}>
            {copy.later}
          </Button>
          <Link
            to={notice.url}
            data-initial-focus=""
            className="inline-flex h-9 min-h-9 items-center justify-center rounded-md bg-accent-deep px-3.5 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] font-medium text-on-accent shadow-[var(--shadow-xs)] hover:bg-accent-hover"
            onClick={() => notify.dismissInApp()}
          >
            {copy.open}
          </Link>
        </div>
      </div>
    </Overlay>,
    document.body,
  );
});
