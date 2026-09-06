import { useState } from 'react';
import { useNavigate } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { EmptyArt } from '@/ui/empty-art';
import { markOnboarding } from './mark';
import { ONBOARDING_HREFS } from './model';

export function OnboardingPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = t.onboarding.steps[step];
  const dest = ONBOARDING_HREFS[step];
  if (!copy || dest === undefined) return null;
  const href: string = dest;

  async function skipAll(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await markOnboarding({ dismissed: true });
      navigate(HOME_PATH, { replace: true });
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  function goNext(): void {
    if (step >= ONBOARDING_HREFS.length - 1) {
      navigate(HOME_PATH, { replace: true });
      return;
    }
    setStep((n) => n + 1);
  }

  function goAction(): void {
    if (href.includes('type=weekly')) void markOnboarding({ openedWeekly: true });
    navigate(href, { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-canvas px-10 py-16 text-fg">
      <div className="mx-auto w-full max-w-md">
        <EmptyArt />
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.onboarding.stepOf.replace('{n}', String(step + 1))}
        </p>
        <h1 className="mt-2 text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
          {copy.title}
        </h1>
        <p className="mt-2 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {copy.body}
        </p>
        {error ? <Banner>{error}</Banner> : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={goAction} disabled={busy}>
            {copy.action}
          </Button>
          <Button variant="ghost" onClick={goNext} disabled={busy}>
            {step >= ONBOARDING_HREFS.length - 1 ? t.onboarding.start : t.onboarding.next}
          </Button>
        </div>
        <Button variant="quiet" className="mt-4 px-0" onClick={() => void skipAll()} disabled={busy}>
          {t.onboarding.skipAll}
        </Button>
        {user ? (
          <p className="mt-8 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {user.displayName}
          </p>
        ) : null}
      </div>
    </div>
  );
}
