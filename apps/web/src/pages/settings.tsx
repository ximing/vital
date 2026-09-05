import { t } from '@/copy';
import { ThemeToggle } from '@/shell/ThemeToggle';
import { VitalMark } from '@/shell/VitalMark';
import { useAuthStore } from '@/state/auth-store';
import { Button } from '@/ui/button';

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="mx-auto max-w-lg px-10 py-16">
      <VitalMark className="mb-5 h-10 w-10 text-accent" />
      <h1 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
        {t.settings.title}
      </h1>
      <p className="mt-2 text-muted">{t.empty.settings}</p>

      <section className="mt-10">
        <h2 className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {t.settings.account}
        </h2>
        {user ? (
          <div className="mt-2">
            <p className="text-fg">{user.displayName}</p>
            <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
              {user.email}
            </p>
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {t.settings.appearance}
        </h2>
        <ThemeToggle />
      </section>

      <Button variant="quiet" className="mt-10 px-0" onClick={() => void logout()}>
        {t.nav.logout}
      </Button>
    </div>
  );
}
