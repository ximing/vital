import { useEffect, useRef, type FormEvent } from 'react';
import { t } from '@/copy';
import { QUICK_ADD_ID } from './keyboard';
import { useTodosUi } from './todos-ui.service';

export function QuickAdd({
  onSubmit,
  disabled,
  hint,
}: {
  onSubmit: (title: string) => Promise<void> | void;
  disabled?: boolean;
  hint?: string;
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
    <form onSubmit={handle} className="pb-3 pt-3">
      <input
        id={QUICK_ADD_ID}
        ref={inputRef}
        type="text"
        name="title"
        maxLength={500}
        disabled={disabled}
        placeholder={hint ?? t.todos.quickAddPlaceholder}
        aria-label={hint ?? t.todos.quickAddPlaceholder}
        className="field-focus h-10 w-full rounded-md border-0 bg-surface-muted px-3 text-fg shadow-none placeholder:text-muted outline-none transition-[border-color,box-shadow,background-color] duration-[var(--ease-out)] focus:border focus:border-border focus:bg-surface"
      />
    </form>
  );
}
