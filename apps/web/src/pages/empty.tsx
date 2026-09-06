import { Link } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { EmptyArt } from '@/ui/empty-art';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col justify-center px-10 py-16">
      <div className="max-w-md">
        <EmptyArt />
        <h1 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
          {t.empty.notFound}
        </h1>
        <p className="mt-2 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {t.empty.notFound}
        </p>
        <Link
          to={HOME_PATH}
          className="mt-5 inline-flex min-h-[var(--touch-min)] items-center rounded-md bg-accent-subtle px-4 text-fg transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted"
        >
          {t.empty.actionHome}
        </Link>
      </div>
    </div>
  );
}
