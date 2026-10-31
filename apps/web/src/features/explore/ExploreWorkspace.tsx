import type { ExplorationFactStatus, ExplorationProposal } from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { useState, type FC } from 'react';
import { Link, useParams } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { HOME_PATH } from '@/routes';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { useExploreActions, useExplorationWindowQuery } from './queries';

const BACK_LINK_CLASS =
  'mt-4 inline-flex items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] text-muted transition-colors hover:bg-surface-muted hover:text-fg';

const copy = t.explore;

function statusLabel(status: ExplorationFactStatus): string {
  if (status === 'verified') return copy.verified;
  if (status === 'changed') return copy.changed;
  return copy.unknown;
}

function formatFetched(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ProposalCard({
  item,
  rest,
  busy,
  acceptUnknown,
  onAcceptUnknown,
  onSelect,
  onConfirm,
  onReject,
}: {
  item: ExplorationProposal;
  rest: boolean;
  busy: boolean;
  acceptUnknown: boolean;
  onAcceptUnknown: (value: boolean) => void;
  onSelect: () => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const content = item.content;
  const unknown = item.verifications.some((row) => row.status === 'unknown');
  const selectable = item.status === 'proposed';
  const confirmable =
    item.status === 'draft_ready' ||
    item.status === 'selected' ||
    item.status === 'verification_pending';
  const confirmed = item.status === 'confirmed' || item.status === 'completed';
  const canceled = item.status === 'canceled';

  return (
    <article
      data-region="explore-proposal"
      className="rounded-[18px] bg-surface px-5 py-4"
    >
      <h2 className="text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] text-fg">
        {content.title || item.activityKey}
      </h2>
      <p className="mt-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {content.reason}
      </p>
      <p className="mt-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg">
        {content.experience}
      </p>
      <dl className="mt-3 space-y-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
        <div>
          <dt className="inline font-medium text-muted">{copy.cost} · </dt>
          <dd className="inline">
            {content.timeCost}
            {content.moneyRange ? ` · ${content.moneyRange}` : ''}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-muted">{copy.constraints} · </dt>
          <dd className="inline">
            {content.companions}
            {content.cancelPolicy ? ` · ${content.cancelPolicy}` : ''}
          </dd>
        </div>
        {content.source ? (
          <div>
            <dt className="inline font-medium text-muted">{copy.source} · </dt>
            <dd className="inline">{content.source}</dd>
          </div>
        ) : null}
        {content.fetchedAt ? (
          <div>
            <dt className="inline font-medium text-muted">{copy.fetched} · </dt>
            <dd className="inline font-mono tabular-nums">{formatFetched(content.fetchedAt)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="inline font-medium text-muted">{copy.freeTime} · </dt>
          <dd className="inline">{content.leaveFreeTime}</dd>
        </div>
        {content.alternative ? (
          <div>
            <dt className="inline font-medium text-muted">{copy.alternative} · </dt>
            <dd className="inline">{content.alternative}</dd>
          </div>
        ) : null}
      </dl>
      {item.verifications.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {item.verifications.map((row) => (
            <li key={row.id}>
              {row.field} · {statusLabel(row.status)}
              {row.url ? ` · ${row.url}` : ''}
              {row.fetchedAt ? ` · ${formatFetched(row.fetchedAt)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {confirmed ? (
        <p className="mt-3 text-[length:var(--text-meta)] text-muted">{copy.confirmed}</p>
      ) : null}
      {!rest && !canceled && !confirmed ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {selectable ? (
            <Button size="sm" disabled={busy} onClick={onSelect}>
              {copy.select}
            </Button>
          ) : null}
          {confirmable ? (
            <>
              {unknown ? (
                <label className="mr-2 inline-flex items-center gap-1.5 text-[length:var(--text-caption)] text-muted">
                  <input
                    type="checkbox"
                    checked={acceptUnknown}
                    onChange={(event) => onAcceptUnknown(event.target.checked)}
                  />
                  {copy.acceptUnknown}
                </label>
              ) : null}
              <Button
                size="sm"
                disabled={busy || (unknown && !acceptUnknown)}
                onClick={onConfirm}
              >
                {copy.confirm}
              </Button>
            </>
          ) : null}
          <Button variant="quiet" size="sm" disabled={busy} onClick={onReject}>
            {copy.reject}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function ExploreWorkspaceContent() {
  const { windowId = '' } = useParams();
  const query = useExplorationWindowQuery(windowId);
  const actions = useExploreActions(windowId);
  const [error, setError] = useState<string | null>(null);
  const [acceptUnknown, setAcceptUnknown] = useState<Record<string, boolean>>({});

  const detail = query.data ?? null;
  const live = (detail?.proposals ?? []).filter((row) => row.status !== 'canceled').slice(0, 3);
  const rest = detail?.status === 'rest';
  const busy =
    actions.rest.isPending ||
    actions.select.isPending ||
    actions.confirm.isPending ||
    actions.reject.isPending;

  function onError(err: unknown): void {
    setError(humanError(err));
  }

  const backLink = (
    <Link to={HOME_PATH} className={BACK_LINK_CLASS}>
      {copy.back}
    </Link>
  );

  if (query.isLoading) {
    return (
      <div className="flex h-full min-h-0 bg-canvas">
        <main id="main" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-[880px] px-6 pb-16 md:px-8">{backLink}</div>
        </main>
      </div>
    );
  }

  if (query.error !== null || detail === null) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex h-full min-h-0 bg-canvas">
        <main id="main" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-[880px] px-6 pb-16 md:px-8">
            {backLink}
            <p className="mt-8 text-[length:var(--text-meta)] text-muted">
              {missing ? copy.missing : copy.loadFailed}
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <main
        id="main"
        data-region="explore-detail"
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[880px] px-6 pb-16 md:px-8">
          {backLink}
          <header className="mt-4 flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <h1 className="font-display text-[30px] font-bold leading-[38px]">{copy.title}</h1>
              <p className="mt-1 font-mono text-[length:var(--text-meta)] tabular-nums text-tertiary">
                {detail.startDate} – {detail.endDate}
              </p>
            </div>
            {detail.status === 'open' ? (
              <Button
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  actions.rest.mutate(undefined, { onError });
                }}
              >
                {copy.rest}
              </Button>
            ) : null}
          </header>
          {detail.cityPrompt ? (
            <p className="mt-3 px-1 text-[length:var(--text-meta)] text-muted">{detail.cityPrompt}</p>
          ) : null}
          {rest ? (
            <p className="mt-3 px-1 text-[length:var(--text-meta)] text-muted">{copy.restHint}</p>
          ) : null}
          {error ? (
            <div className="mt-3">
              <Banner>{error}</Banner>
            </div>
          ) : null}
          {live.length === 0 ? (
            <p className="mt-8 px-1 text-[length:var(--text-meta)] text-muted">{copy.empty}</p>
          ) : (
            <div className="mt-6 flex flex-col gap-3">
              {live.map((item) => (
                <ProposalCard
                  key={item.id}
                  item={item}
                  rest={rest}
                  busy={busy}
                  acceptUnknown={acceptUnknown[item.id] === true}
                  onAcceptUnknown={(value) =>
                    setAcceptUnknown((prev) => ({ ...prev, [item.id]: value }))
                  }
                  onSelect={() => {
                    setError(null);
                    actions.select.mutate(item.id, { onError });
                  }}
                  onConfirm={() => {
                    setError(null);
                    actions.confirm.mutate(
                      {
                        proposalId: item.id,
                        ...(unknownNeedsAccept(item) && acceptUnknown[item.id]
                          ? { acceptUnknown: true }
                          : {}),
                      },
                      { onError },
                    );
                  }}
                  onReject={() => {
                    setError(null);
                    actions.reject.mutate(item.id, { onError });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function unknownNeedsAccept(item: ExplorationProposal): boolean {
  return item.verifications.some((row) => row.status === 'unknown');
}

export const ExploreWorkspace: FC = ExploreWorkspaceContent;
