import { t } from '@/copy';
import { EmptyArt } from '@/ui/empty-art';
import { BTN_PRIMARY_SM } from './classes';

const copy = t.settings.habits;

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface px-8 py-11 text-center">
      <EmptyArt className="mb-0" />
      <p className="mt-4 font-display text-[length:var(--text-section)] font-semibold">
        {copy.emptyTitle}
      </p>
      <p className="mt-1 max-w-sm text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {copy.emptyBody}
      </p>
      <button type="button" onClick={onAdd} className={`${BTN_PRIMARY_SM} mt-4 h-[32px] px-4`}>
        ＋ {copy.emptyCta}
      </button>
    </div>
  );
}
