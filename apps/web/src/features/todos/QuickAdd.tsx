import { useEffect, useRef, type FormEvent } from 'react';
import { t } from '@/copy';
import { QUICK_ADD_ID } from './keyboard';
import { useTodosUi } from './todos-ui.service';

export function QuickAdd({
  onSubmit,
  disabled,
}: {
  onSubmit: (title: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nonce = useTodosUi((s) => s.quickAddNonce);

  useEffect(() => {
    if (nonce > 0) inputRef.current?.focus();
  }, [nonce]);

  function handle(event: FormEvent) {
    event.preventDefault();
    const el = inputRef.current;
    if (!el || disabled) return;
    const title = el.value.trim();
    if (title === '') return;
    el.value = '';
    void onSubmit(title);
  }

  return (
    <form onSubmit={handle} className="px-4 pb-3 pt-1">
      <input
        id={QUICK_ADD_ID}
        ref={inputRef}
        type="text"
        name="title"
        maxLength={500}
        disabled={disabled}
        placeholder={t.todos.quickAddPlaceholder}
        aria-label={t.todos.quickAddPlaceholder}
        className="h-[var(--field-h)] w-full rounded-md border border-border bg-surface px-3 text-fg placeholder:text-muted"
      />
    </form>
  );
}
