import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/copy';
import { OPEN_SHORTCUTS_EVENT, shortcutGroups } from '@/shell/shortcuts';
import { Icon } from '@/ui/icon';
import { Overlay } from '@/ui/overlay';

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onOpen(): void {
      setOpen(true);
    }
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
  }, []);

  if (!open) return null;

  const groups = shortcutGroups();

  return (
    <Overlay
      tone="scrim"
      align="center"
      className="px-4"
      onClose={() => setOpen(false)}
      closeOnEscape
      closeOnBackdrop
      lockFocus
      restoreFocus
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.shortcuts.title}
        className="flex max-h-[min(80vh,680px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-[length:var(--text-section)] font-semibold">
            {t.shortcuts.title}
          </h2>
          <button
            type="button"
            aria-label={t.shortcuts.close}
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
          >
            <Icon icon={X} size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {groups.map((group) => (
            <section key={group.id} className="pb-4">
              <h3 className="eyebrow">{group.title}</h3>
              <ul className="mt-1">
                {group.rows.map((row) => (
                  <li
                    key={`${group.id}-${row.label}`}
                    className="flex items-center justify-between gap-4 border-b border-border/50 py-1.5 last:border-b-0"
                  >
                    <span className="min-w-0 text-[length:var(--text-meta)] text-fg">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((key, index) => (
                        <span key={key} className="inline-flex items-center gap-1">
                          {index > 0 ? <span className="text-[length:var(--text-caption)] text-tertiary">/</span> : null}
                          <kbd className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[length:var(--text-caption)] text-secondary">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
