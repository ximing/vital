import { bindServices, useService } from '@rabjs/react';
import type { FC } from 'react';
import { useNavigate } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { EmptyArt } from '@/ui/empty-art';
import { markOnboarding } from './mark';
import { ONBOARDING_HREFS } from './model';
import { OnboardingPageService } from './onboarding-page.service';

function OnboardingPageContent() {
  const page = useService(OnboardingPageService);
  const navigate = useNavigate();
  const user = page.auth.user;
  const busy = page.$model.skipAll.loading;
  const copy = t.onboarding.steps[page.step];
  const dest = ONBOARDING_HREFS[page.step];
  if (!copy || dest === undefined) return null;
  const href: string = dest;

  function goNext(): void {
    if (page.next() === 'home') navigate(HOME_PATH, { replace: true });
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
          {t.onboarding.stepOf.replace('{n}', String(page.step + 1))}
        </p>
        <h1 className="mt-2 text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
          {copy.title}
        </h1>
        <p className="mt-2 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {copy.body}
        </p>
        {page.error ? <Banner>{page.error}</Banner> : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={goAction} disabled={busy}>
            {copy.action}
          </Button>
          <Button variant="ghost" onClick={goNext} disabled={busy}>
            {page.step >= ONBOARDING_HREFS.length - 1 ? t.onboarding.start : t.onboarding.next}
          </Button>
        </div>
        <Button
          variant="quiet"
          className="mt-4 px-0"
          onClick={() => {
            void page.skipAll().then((ok) => {
              if (ok) navigate(HOME_PATH, { replace: true });
            });
          }}
          disabled={busy}
        >
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

export const OnboardingPage: FC = bindServices(OnboardingPageContent, [OnboardingPageService]);
