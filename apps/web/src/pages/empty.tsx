import { Link } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { VitalMark } from '@/shell/VitalMark';

function EmptyFrame({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="flex min-h-screen flex-col justify-center px-10 py-16">
      <div className="max-w-md">
        <VitalMark className="mb-5 h-10 w-10 text-accent" />
        <h1 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
          {title}
        </h1>
        <p className="mt-2 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {body}
        </p>
        {action ? (
          <Link
            to={action.to}
            className="mt-5 inline-flex min-h-[var(--touch-min)] items-center rounded-md bg-accent-subtle px-4 text-fg transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted"
          >
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function ReportsPage() {
  return (
    <EmptyFrame
      title={t.nav.reports}
      body={t.empty.reports}
      action={{ to: '/reports', label: t.empty.actionDaily }}
    />
  );
}

export function ReportEditorPage() {
  return <EmptyFrame title={t.nav.reports} body={t.empty.reportEditor} />;
}

export function SearchPage() {
  return <EmptyFrame title={t.nav.search} body={t.empty.search} />;
}

export function LibraryPage() {
  return <EmptyFrame title={t.nav.library} body={t.empty.library} />;
}

export function OnboardingPage() {
  return (
    <EmptyFrame
      title={t.nav.onboarding}
      body={t.empty.onboarding}
      action={{ to: HOME_PATH, label: t.empty.actionHome }}
    />
  );
}

export function NotFoundPage() {
  return (
    <EmptyFrame
      title={t.empty.notFound}
      body={t.empty.notFound}
      action={{ to: HOME_PATH, label: t.empty.actionHome }}
    />
  );
}
