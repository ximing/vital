import { ONBOARDING_CHECKLIST_KEYS } from '@vital/dto';
import { useNavigate } from 'react-router';
import { t } from '@/copy';
import { useAuthStore } from '@/state/auth-store';
import { markOnboarding } from './mark';
import { checklistHref, remainingCount, showChecklist } from './model';

export function ActivationChecklist() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const state = user?.onboarding;
  if (!state || !showChecklist(state)) return null;
  const left = remainingCount(state);

  return (
    <aside
      className="fixed bottom-6 right-6 z-[var(--z-sticky)] w-72 rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow)]"
      aria-label={t.checklist.title}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[length:var(--text-meta)] font-semibold leading-[var(--text-meta-lh)]">
            {t.checklist.title}
          </p>
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.checklist.remaining.replace('{n}', String(left))}
          </p>
        </div>
        <button
          type="button"
          className="min-h-[var(--touch-min)] text-[length:var(--text-caption)] text-muted hover:text-fg"
          onClick={() => void markOnboarding({ dismissed: true })}
        >
          {t.checklist.dismiss}
        </button>
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        {ONBOARDING_CHECKLIST_KEYS.map((key) => {
          const done = state[key] === true;
          return (
            <li key={key}>
              <button
                type="button"
                className="flex min-h-[var(--touch-min)] w-full items-center gap-2 rounded-md px-1 text-left text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] hover:bg-surface-muted"
                onClick={() => navigate(checklistHref(key))}
              >
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                    done ? 'border-accent bg-accent text-on-accent' : 'border-border'
                  }`}
                  aria-hidden="true"
                >
                  {done ? '✓' : ''}
                </span>
                <span className={done ? 'text-muted line-through' : 'text-fg'}>
                  {t.checklist.items[key]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
