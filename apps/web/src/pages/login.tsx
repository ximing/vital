import { bindServices, useService } from '@rabjs/react';
import { type FC, type FormEvent, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { t } from '@/copy';
import { AuthLayout } from '@/pages/auth-layout';
import { LoginQr } from '@/pages/login-qr';
import { LoginPageService, type QrLoginPhase } from '@/pages/login.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

function qrHint(status: QrLoginPhase): string {
  if (status === 'scanned') return t.auth.qrScanned;
  if (status === 'expired') return t.auth.qrExpired;
  if (status === 'cancelled') return t.auth.qrCancelled;
  if (status === 'loading') return t.auth.qrLoading;
  return t.auth.qrHint;
}

function LoginPageContent() {
  const page = useService(LoginPageService);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const from = location.state?.from;
  const submitting = page.$model.login.loading;

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const run = () => {
      void page.advanceQr(from, () => stopped).then((outcome) => {
        if (stopped) return;
        if (outcome.kind === 'authed') {
          navigate(outcome.dest, { replace: true });
          return;
        }
        const delay = outcome.kind === 'again' ? 0 : document.hidden ? 4_000 : 1_500;
        timer = window.setTimeout(run, delay);
      });
    };
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [page, from, navigate]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!page.validate()) return;
    void page.login(from).then((dest) => {
      if (dest) navigate(dest, { replace: true });
    });
  }

  return (
    <AuthLayout title={t.auth.loginTitle} kicker={t.auth.loginKicker}>
      <div className="mb-6 flex flex-col items-center">
        <LoginQr ticket={page.ticket} />
        <p
          aria-live="polite"
          className="mt-3 text-center text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
        >
          {qrHint(page.qrStatus)}
        </p>
        {page.qrError ? (
          <div className="mt-3 w-full">
            <Banner>{page.qrError}</Banner>
          </div>
        ) : null}
      </div>
      <div className="mb-4 flex items-center gap-3 text-[length:var(--text-meta)] text-muted">
        <span className="h-px flex-1 bg-border" />
        {t.auth.qrOr}
        <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          label={t.auth.email}
          name="email"
          type="email"
          autoComplete="email"
          value={page.email}
          onChange={(e) => page.setEmail(e.target.value)}
          error={page.errors.email}
        />
        <Field
          label={t.auth.password}
          name="password"
          type="password"
          autoComplete="current-password"
          value={page.password}
          onChange={(e) => page.setPassword(e.target.value)}
          error={page.errors.password}
        />
        {page.formError ? <Banner>{page.formError}</Banner> : null}
        <Button type="submit" className="w-full" loading={submitting}>
          {submitting ? t.auth.loggingIn : t.auth.loginSubmit}
        </Button>
      </form>
      <p className="mt-5 text-center text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {t.auth.noAccount}{' '}
        <Link
          to="/register"
          state={location.state}
          className="text-fg underline decoration-accent underline-offset-4"
        >
          {t.nav.register}
        </Link>
      </p>
    </AuthLayout>
  );
}

export const LoginPage: FC = bindServices(LoginPageContent, [LoginPageService]);
