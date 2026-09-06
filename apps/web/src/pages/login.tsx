import { loginInputSchema } from '@vital/dto';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { needsOnboarding } from '@/features/onboarding';
import { humanError } from '@/lib/errors';
import { AuthLayout } from '@/pages/auth-layout';
import { authService, useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

type FieldErrors = { email?: string; password?: string };

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email' && next.email === undefined) next.email = t.auth.invalidEmail;
        if (issue.path[0] === 'password' && next.password === undefined) {
          next.password = t.auth.passwordRequired;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    void login(parsed.data)
      .then(() => {
        const from = location.state?.from;
        const user = authService().user;
        const dest =
          from && from !== '/login' && from !== '/register'
            ? from
            : needsOnboarding(user)
              ? '/onboarding'
              : HOME_PATH;
        navigate(dest, { replace: true });
      })
      .catch((err: unknown) => setFormError(humanError(err)))
      .finally(() => setSubmitting(false));
  }

  return (
    <AuthLayout title={t.auth.loginTitle} kicker={t.auth.loginKicker}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          label={t.auth.email}
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Field
          label={t.auth.password}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        {formError ? <Banner>{formError}</Banner> : null}
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
