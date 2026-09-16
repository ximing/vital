import type { OutcomeDetail } from '@vital/dto';
import { useService } from '@rabjs/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { inboxKeys, useInboxListQuery } from '@/features/inbox';
import { humanError } from '@/lib/errors';
import { QueryService } from '@/services/query.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Overlay } from '@/ui/overlay';
import { useAllOutcomesQuery } from './queries';

function AttachDialog({
  detail,
  onDone,
  onCancel,
}: {
  detail: OutcomeDetail;
  onDone: () => void;
  onCancel: () => void;
}) {
  const inboxQuery = useInboxListQuery();
  const outcomesQuery = useAllOutcomesQuery();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachedIds = new Set(detail.materials.map((material) => material.id));
  const outcomeNames = new Map((outcomesQuery.data ?? []).map((outcome) => [outcome.id, outcome.name]));
  const candidates = (inboxQuery.data ?? []).filter(
    (item) =>
      item.deletedAt === null &&
      item.status !== 'converted' &&
      !attachedIds.has(item.id) &&
      (search.trim() === '' || item.title.includes(search.trim())),
  );

  function toggle(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      for (const id of picked) {
        await client.patchInbox(id, { outcomeId: detail.outcome.id });
      }
      onDone();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Overlay tone="scrim" align="center" className="px-4" onClose={onCancel} closeOnEscape lockFocus restoreFocus>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.thread.attachTitle}
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col rounded-xl border border-border bg-elevated p-6 shadow-[var(--shadow)]"
      >
        <h2 className="font-display text-[length:var(--text-section)] font-semibold">
          {t.thread.attachTitle}
        </h2>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t.thread.attachSearch}
          aria-label={t.thread.attachSearch}
          className="mt-4 w-full rounded-md border border-border bg-surface px-3 py-2 text-[length:var(--text-body)] text-fg outline-none placeholder:text-tertiary focus:border-accent"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-[length:var(--text-meta)] text-muted">
              {t.thread.attachEmpty}
            </p>
          ) : (
            candidates.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-[length:var(--text-body)] hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  checked={picked.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className="accent-[var(--accent-primary)]"
                />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-[length:var(--text-caption)] text-tertiary">
                  {item.outcomeId !== null && outcomeNames.has(item.outcomeId)
                    ? t.thread.attachBelongsTo.replace(
                        '{name}',
                        outcomeNames.get(item.outcomeId) ?? '',
                      )
                    : t.thread.attachUnfiled}
                </span>
              </label>
            ))
          )}
        </div>
        <p className="mt-3 text-[length:var(--text-caption)] text-tertiary">
          {t.thread.attachMoveHint}
        </p>
        {error ? (
          <div className="mt-2">
            <Banner>{error}</Banner>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" onClick={onCancel}>
            {t.thread.cancel}
          </Button>
          <Button onClick={() => void submit()} disabled={picked.size === 0} loading={pending}>
            {t.thread.attachSubmit}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}

export function ThreadMaterials({
  detail,
  onRefresh,
}: {
  detail: OutcomeDetail;
  onRefresh: () => void;
}) {
  const query = useService(QueryService);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detachedToast, setDetachedToast] = useState(false);

  async function detach(id: string): Promise<void> {
    setError(null);
    try {
      await client.patchInbox(id, { outcomeId: null });
      setDetachedToast(true);
      onRefresh();
      await query.invalidate(inboxKeys.all);
    } catch (err) {
      setError(humanError(err));
    }
  }

  return (
    <section aria-label={t.thread.materialsSection} className="mt-8">
      <div className="flex items-center gap-3 px-2">
        <h2 className="eyebrow eyebrow-rule min-w-0 flex-1">{t.thread.materialsSection}</h2>
        <button
          type="button"
          className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] font-medium text-accent transition-colors hover:bg-accent-subtle"
          onClick={() => setAttaching(true)}
        >
          {t.thread.attach}
        </button>
      </div>

      {error ? (
        <div className="mt-2 px-2">
          <Banner>{error}</Banner>
        </div>
      ) : null}
      {detachedToast ? (
        <p role="status" className="mt-2 px-2 text-[length:var(--text-caption)] text-tertiary">
          {t.thread.detachedToast}
        </p>
      ) : null}

      {detail.materials.length === 0 ? (
        <p className="px-2 py-6 text-center text-[length:var(--text-meta)] text-muted">
          {t.thread.emptyMaterials}
        </p>
      ) : (
        detail.materials.map((material) => (
          <div
            key={material.id}
            className="flex items-center gap-3 border-b border-border/60 px-2 py-3"
          >
            <div className="min-w-0 flex-1">
              <Link
                to={`/inbox/${material.id}`}
                className="block truncate text-[length:var(--text-body)] text-fg underline-offset-4 hover:underline"
              >
                {material.title}
              </Link>
              <p className="mt-0.5 text-[length:var(--text-caption)] text-tertiary">
                {material.siteName ?? t.inbox.source[material.source]}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-[length:var(--text-meta)] text-tertiary transition-colors hover:bg-surface-muted hover:text-fg"
              onClick={() => void detach(material.id)}
            >
              {t.thread.detach}
            </button>
          </div>
        ))
      )}

      {attaching ? (
        <AttachDialog
          detail={detail}
          onDone={() => {
            setAttaching(false);
            onRefresh();
            void query.invalidate(inboxKeys.all);
          }}
          onCancel={() => setAttaching(false)}
        />
      ) : null}
    </section>
  );
}
