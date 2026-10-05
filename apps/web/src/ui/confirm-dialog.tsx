import { LoaderCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Overlay } from '@/ui/overlay';

/** Centered confirm: scrim, Esc to dismiss, no click-outside. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  pending = false,
  focusConfirm = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  /** Confirm is in flight: spinner on the confirm button, dismiss is ignored. */
  pending?: boolean;
  /** Open with focus on the confirm button. Default is the cancel button. */
  focusConfirm?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  function cancel(): void {
    if (pending) return;
    onCancel();
  }

  function confirm(): void {
    if (pending) return;
    onConfirm();
  }

  return createPortal(
    <Overlay
      tone="scrim"
      align="center"
      className="px-4"
      onClose={cancel}
      closeOnEscape
      lockFocus
      restoreFocus
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[440px] rounded-xl border border-border bg-elevated p-6 shadow-[var(--shadow)]"
      >
        <h2 className="font-display text-[length:var(--text-section)] font-semibold">{title}</h2>
        <p className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {body}
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-danger"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onClick={cancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={confirm}
            loading={pending}
            className="gap-1.5"
            data-initial-focus={focusConfirm ? '' : undefined}
          >
            {pending ? (
              <Icon
                icon={LoaderCircle}
                size={14}
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Overlay>,
    document.body,
  );
}
