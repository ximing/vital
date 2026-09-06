import type { ReactNode } from 'react';
import { t } from '@/copy';
import { VitalMark } from '@/shell/VitalMark';

export function AuthLayout({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(260px,42%)_1fr]">
      <section
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between"
        style={{ background: 'var(--ink-950)', color: 'var(--pulse-100)' }}
      >
        <div
          className="pointer-events-none absolute -left-16 top-16 h-[22rem] w-[22rem] opacity-40"
          style={{ color: 'var(--pulse-400)' }}
        >
          <VitalMark className="pulse-mark h-full w-full" />
        </div>
        <div
          className="pointer-events-none absolute bottom-0 right-0 h-48 w-px"
          style={{ background: 'linear-gradient(to top, var(--pulse-500), transparent)' }}
        />
        <div className="relative px-10 pt-12">
          <div className="flex items-center gap-2">
            <VitalMark className="h-8 w-8" style={{ color: 'var(--pulse-400)' }} />
            <span className="text-[length:var(--text-display)] font-semibold leading-[var(--text-display-lh)] tracking-[-0.03em]">
              {t.brand.wordmark}
            </span>
          </div>
        </div>
        <div className="relative px-10 pb-12">
          <p
            className="text-[length:var(--text-body)] leading-[var(--text-body-lh)]"
            style={{ color: 'var(--ink-200)' }}
          >
            {t.brand.tagline}
          </p>
          <p
            className="mt-3 max-w-xs text-[length:var(--text-meta)] leading-[var(--text-meta-lh)]"
            style={{ color: 'var(--ink-400)' }}
          >
            {kicker}
          </p>
        </div>
      </section>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <VitalMark className="h-8 w-8 text-accent" />
            <span className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
              {t.brand.wordmark}
            </span>
          </div>
          <h1 className="mb-6 text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
            {title}
          </h1>
          {children}
        </div>
      </div>
    </div>
  );
}
