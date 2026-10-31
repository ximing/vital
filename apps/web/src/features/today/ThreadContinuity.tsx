import { ApiError } from '@vital/api-client';
import type {
  ContinuityCadence,
  ContinuityContractSummary,
  ContinuityDependency,
  ContinuityJudgement,
} from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FC } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { AgentChatService } from '@/features/agent-chat/agent-chat.service';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { PromptDialog } from '@/ui/prompt-dialog';
import {
  invalidateContinuity,
  useOutcomeContinuityDependenciesQuery,
  useOutcomeContinuityQuery,
} from './queries';
import { formatHmOf } from './thread-format';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const copy = t.thread.continuity;

const SECONDARY_CLASS =
  'inline-flex h-8 items-center rounded-md px-2.5 text-[length:var(--text-meta)] font-medium text-muted transition-colors hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60';

function isDisabledError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'CONTINUITY_DISABLED';
}

function judgementLabel(value: ContinuityJudgement): string {
  if (value === 'on_track') return copy.judgementOnTrack;
  if (value === 'watching') return copy.judgementWatching;
  if (value === 'needs_adjust') return copy.judgementNeedsAdjust;
  return copy.judgementWaiting;
}

function cadenceLabel(cadence: ContinuityCadence): string {
  if (cadence.kind === 'weekly_count') {
    return copy.cadenceWeekly
      .replace('{n}', String(cadence.count))
      .replace('{m}', String(cadence.durationMin));
  }
  return cadence.slots
    .map((slot) =>
      copy.cadenceSlot
        .replace('{day}', t.todos.weekday[slot.weekday] ?? '')
        .replace('{time}', slot.startHm)
        .replace('{m}', String(slot.durationMin)),
    )
    .join('、');
}

function minActionLabel(contract: ContinuityContractSummary): string {
  const title = contract.minAction.title.trim();
  const duration = copy.duration.replace('{m}', String(contract.minAction.durationMin));
  const standard = contract.minAction.completionStandard.trim();
  const head = title !== '' ? `${title} · ${duration}` : duration;
  return standard !== '' ? `${head} · ${standard}` : head;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  if (value.trim() === '') return null;
  return (
    <div className="px-2 py-2">
      <dt className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
        {label}
      </dt>
      <dd className="mt-0.5 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-fg">
        {value}
      </dd>
    </div>
  );
}

function lifecycleLabel(lifecycle: ContinuityContractSummary['lifecycle']): string | null {
  if (lifecycle === 'draft') return copy.draft;
  if (lifecycle === 'paused') return copy.paused;
  if (lifecycle === 'ended') return copy.ended;
  return null;
}

function DependencyRow({
  item,
  timeZone,
  busy,
  onPing,
  onResolve,
}: {
  item: ContinuityDependency;
  timeZone: string;
  busy: boolean;
  onPing: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const label =
    item.prerequisiteType === 'external'
      ? (item.externalLabel ?? copy.deps)
      : item.prerequisiteId ?? copy.depsWaitingInternal;
  const waitingStamp =
    item.lastUserUpdateAt !== null ? formatHmOf(item.lastUserUpdateAt, timeZone) : '';
  return (
    <li className="px-2 py-2">
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-fg">{label}</p>
      {item.status === 'resolved' ? (
        <p className="mt-0.5 text-[length:var(--text-caption)] text-tertiary">{copy.depsResolved}</p>
      ) : item.prerequisiteType === 'external' ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <p className="text-[length:var(--text-caption)] text-tertiary">
            {waitingStamp !== '' ? `${copy.depsWaitingYou} · ${waitingStamp}` : copy.depsWaitingYou}
          </p>
          <button type="button" className={SECONDARY_CLASS} disabled={busy} onClick={() => onPing(item.id)}>
            {copy.depsUpdated}
          </button>
          <button type="button" className={SECONDARY_CLASS} disabled={busy} onClick={() => onResolve(item.id)}>
            {copy.depsResolve}
          </button>
        </div>
      ) : (
        <p className="mt-0.5 text-[length:var(--text-caption)] text-tertiary">{copy.depsWaitingInternal}</p>
      )}
    </li>
  );
}

function ContractSummary({
  contract,
  timeZone,
}: {
  contract: ContinuityContractSummary;
  timeZone: string;
}) {
  const zone = contract.timezone || timeZone;
  const nextCheck =
    contract.nextCheckAt !== null ? formatHmOf(contract.nextCheckAt, zone) : '';
  return (
    <dl className="mt-1 divide-y divide-border/60">
      <SummaryRow label={copy.meaning} value={contract.meaning} />
      <SummaryRow label={copy.stageGoal} value={contract.stageGoal} />
      <SummaryRow label={copy.cadence} value={cadenceLabel(contract.cadence)} />
      {contract.judgement ? (
        <SummaryRow label={copy.judgement} value={judgementLabel(contract.judgement)} />
      ) : null}
      <SummaryRow label={copy.nextCheck} value={nextCheck} />
      <SummaryRow label={copy.minAction} value={minActionLabel(contract)} />
    </dl>
  );
}

export const ThreadContinuity: FC<{ outcomeId: string; timeZone: string }> = observer(
  function ThreadContinuity({ outcomeId, timeZone }) {
  const chat = useService(AgentChatService);
  const qc = useQueryClient();
  const query = useOutcomeContinuityQuery(outcomeId);
  const contract = query.data?.contract ?? null;
  const lifecycle = contract?.lifecycle ?? null;
  const depsQuery = useOutcomeContinuityDependenciesQuery(
    outcomeId,
    contract !== null && lifecycle !== 'ended',
  );
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);

  function onError(err: unknown): void {
    if (isDisabledError(err)) {
      setDisabled(true);
      setError(null);
      return;
    }
    setError(humanError(err));
  }

  function onSuccess(): void {
    setError(null);
    setDisabled(false);
    invalidateContinuity(qc, outcomeId);
  }

  const activate = useMutation({
    mutationFn: () => client.activateOutcomeContinuity(outcomeId, {}),
    onSuccess,
    onError,
  });
  const pause = useMutation({
    mutationFn: () => client.pauseOutcomeContinuity(outcomeId, {}),
    onSuccess,
    onError,
  });
  const resume = useMutation({
    mutationFn: () => client.resumeOutcomeContinuity(outcomeId, {}),
    onSuccess,
    onError,
  });
  const end = useMutation({
    mutationFn: () => client.endOutcomeContinuity(outcomeId, {}),
    onSuccess: () => {
      setConfirmEnd(false);
      onSuccess();
    },
    onError: (err) => {
      setConfirmEnd(false);
      onError(err);
    },
  });
  const evidence = useMutation({
    mutationFn: (body: string) =>
      client.createContinuityEvidence({
        contractId: query.data?.contract?.id ?? '',
        ...(body !== '' ? { body } : {}),
      }),
    onSuccess,
    onError,
  });
  const addDep = useMutation({
    mutationFn: async (raw: string) => {
      const value = raw.trim();
      if (value === '') return;
      if (UUID_RE.test(value)) {
        try {
          await client.createOutcomeContinuityDependency(outcomeId, {
            prerequisiteType: 'task',
            prerequisiteId: value,
          });
          return;
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 404) throw err;
        }
        await client.createOutcomeContinuityDependency(outcomeId, {
          prerequisiteType: 'outcome',
          prerequisiteId: value,
        });
        return;
      }
      await client.createOutcomeContinuityDependency(outcomeId, {
        prerequisiteType: 'external',
        externalLabel: value,
      });
    },
    onSuccess,
    onError,
  });
  const pingDep = useMutation({
    mutationFn: (id: string) => client.patchContinuityDependency(id, { status: 'open' }),
    onSuccess,
    onError,
  });
  const resolveDep = useMutation({
    mutationFn: (id: string) => client.patchContinuityDependency(id, { status: 'resolved' }),
    onSuccess,
    onError,
  });

  const busy =
    activate.isPending ||
    pause.isPending ||
    resume.isPending ||
    end.isPending ||
    evidence.isPending ||
    addDep.isPending ||
    pingDep.isPending ||
    resolveDep.isPending;

  if (query.isLoading) return null;

  if (query.isError) {
    return (
      <section data-region="thread-continuity" className="mt-6 px-2">
        <p className="text-[length:var(--text-meta)] text-muted">{copy.loadFailed}</p>
        <Button variant="quiet" className="mt-2" onClick={() => void query.refetch()}>
          {t.today.retry}
        </Button>
      </section>
    );
  }

  const showSummary = contract !== null && lifecycle !== 'ended';
  const deps = depsQuery.data?.items ?? [];
  const canActivate = lifecycle === null || lifecycle === 'draft' || lifecycle === 'ended';
  const canPause = lifecycle === 'active';
  const canResume = lifecycle === 'paused';
  const canEvidence = lifecycle === 'active' || lifecycle === 'paused';
  const canEnd = lifecycle === 'active' || lifecycle === 'paused';
  const activateLabel = lifecycle === 'draft' ? copy.startFollow : copy.follow;
  const chip = contract ? lifecycleLabel(contract.lifecycle) : null;

  return (
    <section data-region="thread-continuity" className="mt-6">
      <div className="mb-2.5 flex items-center gap-2.5 px-2">
        <h2 className="text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] text-fg">
          {copy.title}
        </h2>
        {chip ? (
          <span className="shrink-0 text-[length:var(--text-caption)] text-tertiary">{chip}</span>
        ) : null}
        <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
      </div>

      {showSummary && contract ? <ContractSummary contract={contract} timeZone={timeZone} /> : null}

      {showSummary ? (
        <div data-region="thread-continuity-deps" className="mt-4">
          <h3 className="eyebrow eyebrow-rule px-2">{copy.deps}</h3>
          {deps.length === 0 ? (
            <p className="mt-1 px-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
              {copy.depsEmpty}
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-border/60">
              {deps.map((item) => (
                <DependencyRow
                  key={item.id}
                  item={item}
                  timeZone={contract?.timezone || timeZone}
                  busy={busy}
                  onPing={(id) => pingDep.mutate(id)}
                  onResolve={(id) => resolveDep.mutate(id)}
                />
              ))}
            </ul>
          )}
          <div className="mt-1.5 px-2">
            <button
              type="button"
              className={SECONDARY_CLASS}
              disabled={busy}
              onClick={() => {
                setError(null);
                setDepOpen(true);
              }}
            >
              {copy.depsAdd}
            </button>
          </div>
        </div>
      ) : null}

      {lifecycle === null ? (
        <p className="mt-2 px-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {copy.followHint}
        </p>
      ) : null}

      {disabled ? (
        <div
          role="status"
          data-region="continuity-disabled"
          className="mt-3 rounded-lg bg-surface-muted px-3.5 py-2.5 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
        >
          {copy.disabled}
        </div>
      ) : null}
      {error ? (
        <div className="mt-3 px-2">
          <Banner>{error}</Banner>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 px-2">
        {canActivate ? (
          <Button
            size="sm"
            loading={activate.isPending}
            disabled={busy}
            onClick={() => {
              setError(null);
              activate.mutate();
            }}
          >
            {activateLabel}
          </Button>
        ) : null}
        {canPause ? (
          <button
            type="button"
            className={SECONDARY_CLASS}
            disabled={busy}
            onClick={() => {
              setError(null);
              pause.mutate();
            }}
          >
            {copy.pause}
          </button>
        ) : null}
        {canResume ? (
          <Button
            size="sm"
            loading={resume.isPending}
            disabled={busy}
            onClick={() => {
              setError(null);
              resume.mutate();
            }}
          >
            {copy.resume}
          </Button>
        ) : null}
        {canEvidence ? (
          <button
            type="button"
            className={SECONDARY_CLASS}
            disabled={busy}
            onClick={() => {
              setError(null);
              setEvidenceOpen(true);
            }}
          >
            {copy.evidence}
          </button>
        ) : null}
        {canEnd ? (
          <button
            type="button"
            className={SECONDARY_CLASS}
            disabled={busy}
            onClick={() => setConfirmEnd(true)}
          >
            {copy.end}
          </button>
        ) : null}
        {chat.enabled ? (
          <button type="button" className={SECONDARY_CLASS} onClick={() => chat.openFromDeeplink()}>
            {copy.chat}
          </button>
        ) : null}
      </div>

      {evidenceOpen ? (
        <PromptDialog
          title={copy.evidenceTitle}
          confirmLabel={copy.evidenceSubmit}
          cancelLabel={t.thread.cancel}
          onConfirm={(value) => {
            setEvidenceOpen(false);
            evidence.mutate(value.trim());
          }}
          onCancel={() => setEvidenceOpen(false)}
        />
      ) : null}
      {depOpen ? (
        <PromptDialog
          title={copy.depsAddTitle}
          confirmLabel={copy.depsSubmit}
          cancelLabel={t.thread.cancel}
          onConfirm={(value) => {
            setDepOpen(false);
            addDep.mutate(value);
          }}
          onCancel={() => setDepOpen(false)}
        />
      ) : null}
      {confirmEnd ? (
        <ConfirmDialog
          title={copy.endConfirmTitle}
          body={copy.endConfirmBody}
          confirmLabel={copy.end}
          cancelLabel={t.thread.cancel}
          danger
          pending={end.isPending}
          onConfirm={() => end.mutate()}
          onCancel={() => setConfirmEnd(false)}
        />
      ) : null}
    </section>
  );
});
