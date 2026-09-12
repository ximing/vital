import { bindServices, useService } from '@rabjs/react';
import { type FC, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { t } from '@/copy';
import { AuthLayout } from '@/pages/auth-layout';
import { LoginPageService } from '@/pages/login.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

function LoginPageContent() {
  const page = useService(LoginPageService);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const submitting = page.$model.login.loading;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!page.validate()) return;
    void page.login(location.state?.from).then((dest) => {
      if (dest) navigate(dest, { replace: true });
    });
  }

  return (
    <AuthLayout title={t.auth.loginTitle} kicker={t.auth.loginKicker}>
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
