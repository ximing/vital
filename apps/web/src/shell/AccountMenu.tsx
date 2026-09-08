import { Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import { t } from '@/copy';
import { useAuth } from '@/services/auth.service';
import { initialsOf } from '@/shell/rail-nav';
import { ThemeSwitch } from '@/shell/ThemeToggle';
import { Icon } from '@/ui/icon';

export function AccountMenu({ collapsed, railWidth }: { collapsed: boolean; railWidth: number }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initials = initialsOf(user?.displayName ?? '');

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative mx-1">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        title={user?.displayName}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-9 w-full items-center rounded-md text-left text-muted hover:bg-surface-muted hover:text-fg ${
          collapsed ? 'justify-center' : 'gap-2 px-1'
        }`}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[length:var(--text-caption)] font-semibold leading-none"
          aria-hidden
        >
          {initials}
        </span>
        {collapsed ? null : (
          <span className="min-w-0 flex-1 truncate text-[length:var(--text-meta)] leading-[var(--text-meta-lh)]">
            {user?.displayName ?? ''}
          </span>
        )}
      </button>
      {open ? (
        <div
          role="menu"
          className="fixed z-[var(--z-lightbox)] w-56 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-[var(--shadow)]"
          style={{ left: collapsed ? railWidth + 8 : 8, bottom: 8 }}
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-[length:var(--text-meta)] font-medium">{user?.displayName}</p>
            <p className="truncate text-[length:var(--text-caption)] text-muted">{user?.email}</p>
          </div>
          <NavLink
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-[length:var(--text-meta)] text-fg hover:bg-surface-muted"
          >
            <Icon icon={Settings} size={16} />
            {t.nav.settings}
          </NavLink>
          <ThemeSwitch />
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-left text-[length:var(--text-meta)] text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            {t.nav.logout}
          </button>
        </div>
      ) : null}
    </div>
  );
}
