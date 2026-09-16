import { Button } from '@/ui/button';
import { Overlay } from '@/ui/overlay';

/** Centered confirm: scrim, Esc to dismiss, no click-outside. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Overlay
      tone="scrim"
      align="center"
      className="px-4"
      onClose={onCancel}
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
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
