import { bindServices, useService } from '@rabjs/react';
import { type FC, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { t } from '@/copy';
import { AuthLayout } from '@/pages/auth-layout';
import { RegisterPageService } from '@/pages/register.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

function RegisterPageContent() {
  const page = useService(RegisterPageService);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const submitting = page.$model.register.loading;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!page.validate()) return;
    void page.register().then((ok) => {
      if (ok) navigate('/onboarding', { replace: true });
    });
  }

  return (
    <AuthLayout title={t.auth.registerTitle} kicker={t.auth.registerKicker}>
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
          label={t.auth.displayName}
          name="displayName"
          autoComplete="name"
          value={page.displayName}
          onChange={(e) => page.setDisplayName(e.target.value)}
          error={page.errors.displayName}
        />
        <Field
          label={t.auth.password}
          name="password"
          type="password"
          autoComplete="new-password"
          value={page.password}
          onChange={(e) => page.setPassword(e.target.value)}
          error={page.errors.password}
        />
        <Field
          label={t.auth.confirmPassword}
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={page.confirm}
          onChange={(e) => page.setConfirm(e.target.value)}
          error={page.errors.confirm}
        />
        {page.formError ? <Banner>{page.formError}</Banner> : null}
        <Button type="submit" className="w-full" loading={submitting}>
          {submitting ? t.auth.registering : t.auth.registerSubmit}
        </Button>
      </form>
      <p className="mt-5 text-center text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {t.auth.hasAccount}{' '}
        <Link
          to="/login"
          state={location.state}
          className="text-fg underline decoration-accent underline-offset-4"
        >
          {t.nav.login}
        </Link>
      </p>
    </AuthLayout>
  );
}

export const RegisterPage: FC = bindServices(RegisterPageContent, [RegisterPageService]);
