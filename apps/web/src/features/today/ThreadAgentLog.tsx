import type { OutcomeDetail } from '@vital/dto';
import { t } from '@/copy';
import { formatHmOf } from './thread-format';

export function ThreadAgentLog({ detail, timeZone }: { detail: OutcomeDetail; timeZone: string }) {
  return (
    <section aria-label={t.thread.agentLog} className="mt-8">
      <h2 className="eyebrow eyebrow-rule px-2">{t.thread.agentLog}</h2>
      {detail.agentActions.length === 0 ? (
        <p className="px-2 py-6 text-center text-[length:var(--text-meta)] text-muted">
          {t.thread.emptyLog}
        </p>
      ) : (
        <ol className="mt-3">
          {detail.agentActions.map((action) => (
            <li
              key={action.id}
              className="relative ml-1.5 border-l border-border pb-5 pl-5 last:border-transparent last:pb-0"
            >
              <span className="absolute -left-[4px] top-1.5 h-[7px] w-[7px] rounded-full bg-accent" />
              <span className="inline-flex items-center gap-3 text-[length:var(--text-caption)] text-tertiary">
                <span>{formatHmOf(action.createdAt, timeZone)}</span>
                <span>{t.thread.feedback[action.feedback]}</span>
              </span>
              {action.payloadSummary !== '' ? (
                <p className="mt-1 text-[length:var(--text-body)] text-fg">
                  {action.payloadSummary}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
