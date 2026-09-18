import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/ui/button';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { Overlay } from '@/ui/overlay';

/** Centered prompt: scrim, Esc to dismiss, Enter to confirm, no click-outside. */
export function PromptDialog({
  title,
  defaultValue = '',
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  defaultValue?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);

  function submit(event: FormEvent): void {
    event.preventDefault();
    onConfirm(value);
  }

  return createPortal(
    <Overlay
      tone="scrim"
      align="center"
      className="px-4"
      onClose={onCancel}
      closeOnEscape
      lockFocus
      restoreFocus
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[440px] rounded-xl border border-border bg-elevated p-6 shadow-[var(--shadow)]"
        onSubmit={submit}
      >
        <h2 className="font-display text-[length:var(--text-section)] font-semibold">{title}</h2>
        <input
          className={`${FIELD_CONTROL_CLASS} mt-4 w-full`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={title}
          autoComplete="off"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" type="button" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" type="submit">
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Overlay>,
    document.body,
  );
}
