import { registerInputSchema } from '@vital/dto';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthLayout } from '@/pages/auth-layout';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

type FieldErrors = { email?: string; displayName?: string; password?: string; confirm?: string };

export function RegisterPage() {
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (password !== confirm) {
      setErrors({ confirm: t.auth.passwordMismatch });
      return;
    }
    const parsed = registerInputSchema.safeParse({ email, password, displayName });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'email' && next.email === undefined) next.email = t.auth.invalidEmail;
        if (key === 'displayName' && next.displayName === undefined) {
          next.displayName = t.auth.displayNameRequired;
        }
        if (key === 'password' && next.password === undefined) next.password = t.auth.passwordMin;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    void register(parsed.data)
      .then(() => navigate('/onboarding', { replace: true }))
      .catch((err: unknown) => setFormError(humanError(err)))
      .finally(() => setSubmitting(false));
  }

  return (
    <AuthLayout title={t.auth.registerTitle} kicker={t.auth.registerKicker}>
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
          label={t.auth.displayName}
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={errors.displayName}
        />
        <Field
          label={t.auth.password}
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Field
          label={t.auth.confirmPassword}
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        {formError ? <Banner>{formError}</Banner> : null}
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
