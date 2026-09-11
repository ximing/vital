import type {
  AgentMemoryItem,
  AgentMemoryKind,
  AgentMemoryScopeValue,
  PatchAgentMemoryInput,
} from '@vital/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { ACTIVITY_CARD } from './ActivitySectionHead';

const copy = t.settings.memory;

const MEMORY_KEY = ['settings', 'agent-memory'] as const;

const KINDS: AgentMemoryKind[] = ['preference', 'pattern', 'correction'];
const SCOPES: AgentMemoryScopeValue[] = [
  'all',
  'headline',
  'cluster',
  'decompose',
  'draft',
  'reflect',
  'distill',
];

/** Semantic dot per kind: 偏好 accent / 模式 doing / 纠正 due. */
const KIND_DOT: Record<AgentMemoryKind, string> = {
  preference: 'bg-accent',
  pattern: 'bg-doing',
  correction: 'bg-due',
};

function kindLabel(kind: string): string {
  return (copy.kinds as Record<string, string>)[kind] ?? kind;
}

function scopeLabel(value: string): string {
  return (copy.scopes as Record<string, string>)[value] ?? value;
}

/**
 * Toggle one scope value: 'all' clears everything else (it subsumes all
 * capabilities); deselecting the last capability falls back to 'all'.
 */
function toggleScope(current: string[], value: string): string[] {
  if (value === 'all') return ['all'];
  const rest = current.filter((item) => item !== 'all');
  const next = rest.includes(value)
    ? rest.filter((item) => item !== value)
    : [...rest, value];
  return next.length === 0 ? ['all'] : next;
}

function ScopeChips({ scope }: { scope: string[] }) {
  return (
    <span className="flex flex-wrap justify-end gap-1" data-memory-scope={scope.join(',')}>
      {scope.map((value) => (
        <span
          key={value}
          className="inline-flex h-5 items-center rounded-full bg-surface-muted px-2 text-[11px] text-muted"
        >
          {scopeLabel(value)}
        </span>
      ))}
    </span>
  );
}

function ScopePicker({
  scope,
  onToggle,
}: {
  scope: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1" role="group" aria-label={copy.scope}>
      <span className="mr-1 text-[length:var(--text-caption)] text-muted">{copy.scope}</span>
      {SCOPES.map((value) => {
        const active = scope.includes(value);
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(value)}
            className={`h-6 rounded-full px-2.5 text-[11px] font-medium transition-[color,background-color] duration-[var(--ease-out)] ${
              active
                ? 'bg-accent-subtle font-semibold text-accent'
                : 'text-muted hover:bg-surface-muted hover:text-fg'
            }`}
          >
            {scopeLabel(value)}
          </button>
        );
      })}
    </span>
  );
}

const BTN_PRIMARY_SM =
  'inline-flex h-7 items-center rounded-full bg-accent px-3.5 text-[length:var(--text-caption)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';
const BTN_GHOST_SM =
  'inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60';

function MemoryRow({ item }: { item: AgentMemoryItem }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  const [scope, setScope] = useState<string[]>(item.scope);

  const patch = useMutation({
    mutationFn: (input: PatchAgentMemoryInput) => client.patchAgentMemory(item.id, input),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: MEMORY_KEY });
    },
  });
  const remove = useMutation({
    mutationFn: () => client.deleteAgentMemory(item.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MEMORY_KEY });
    },
  });

  const startEdit = () => {
    setContent(item.content);
    setScope(item.scope);
    setEditing(true);
  };

  if (editing) {
    return (
      <li data-memory-row={item.id} data-memory-kind={item.kind} className="px-3 py-2">
        <div className="flex flex-col gap-2.5 rounded-xl bg-surface-muted px-4 py-3.5">
          <textarea
            aria-label={copy.content}
            rows={2}
            maxLength={300}
            className={`${FIELD_CONTROL_CLASS} h-auto w-full bg-elevated py-2`}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <ScopePicker scope={scope} onToggle={(value) => setScope(toggleScope(scope, value))} />
          <span className="flex gap-2">
            <button
              type="button"
              disabled={patch.isPending || content.trim() === ''}
              onClick={() => patch.mutate({ content: content.trim(), scope: scope as AgentMemoryScopeValue[] })}
              className={BTN_PRIMARY_SM}
            >
              {copy.save}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={BTN_GHOST_SM}
            >
              {copy.cancel}
            </button>
          </span>
        </div>
      </li>
    );
  }

  return (
    <li
      data-memory-row={item.id}
      data-memory-kind={item.kind}
      data-memory-manual={item.manual ? 'true' : 'false'}
      className="flex flex-wrap items-start gap-x-3.5 gap-y-2 border-b border-border px-5 py-3.5 last:border-b-0"
    >
      <p className="min-w-0 flex-1 whitespace-pre-wrap pt-px text-[length:var(--text-meta)] leading-[19px] text-fg">
        {item.content}
      </p>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <ScopeChips scope={item.scope} />
        {item.manual ? (
          <span
            data-memory-manual-badge
            className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent-subtle px-2 text-[11px] font-semibold text-accent"
          >
            {copy.manualBadge}
          </span>
        ) : null}
        <span className="shrink-0 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] tabular-nums text-tertiary">
          {copy.sourceCount} {item.sourceCount}
        </span>
        <button type="button" onClick={startEdit} className={BTN_GHOST_SM}>
          {copy.edit}
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          className={`${BTN_GHOST_SM} hover:text-danger`}
        >
          {copy.del}
        </button>
      </span>
    </li>
  );
}

function AddMemoryForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AgentMemoryKind>('preference');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<string[]>(['all']);

  const create = useMutation({
    mutationFn: () => client.createAgentMemory({ kind, content: content.trim(), scope: scope as AgentMemoryScopeValue[] }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MEMORY_KEY });
      onDone();
    },
  });

  return (
    <div data-region="memory-add" className={`${ACTIVITY_CARD} flex flex-col gap-3 px-5 py-4`}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={copy.kind}>
        <span className="mr-1 text-[length:var(--text-caption)] text-muted">{copy.kind}</span>
        {KINDS.map((value) => {
          const active = kind === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setKind(value)}
              className={`inline-flex h-[26px] items-center gap-1.5 rounded-full border px-3 text-[length:var(--text-caption)] font-medium transition-[color,background-color,border-color] duration-[var(--ease-out)] ${
                active
                  ? 'border-accent bg-accent-subtle font-semibold text-accent'
                  : 'border-border text-muted hover:bg-surface-muted hover:text-fg'
              }`}
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[value]}`} />
              {kindLabel(value)}
            </button>
          );
        })}
      </div>
      <textarea
        aria-label={copy.content}
        rows={2}
        maxLength={300}
        placeholder={copy.contentPlaceholder}
        className={`${FIELD_CONTROL_CLASS} h-auto w-full py-2`}
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <ScopePicker scope={scope} onToggle={(value) => setScope(toggleScope(scope, value))} />
      <span className="flex gap-2">
        <button
          type="button"
          disabled={create.isPending || content.trim() === ''}
          onClick={() => create.mutate()}
          className={BTN_PRIMARY_SM}
        >
          {copy.submit}
        </button>
        <button
          type="button"
          onClick={onDone}
          className={BTN_GHOST_SM}
        >
          {copy.cancel}
        </button>
      </span>
    </div>
  );
}

const STAT_NUM =
  'font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tabular-nums';
const STAT_LBL =
  'mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted';

export function MemorySection({
  adding,
  onDoneAdding,
}: {
  adding: boolean;
  onDoneAdding: () => void;
}) {
  const query = useQuery({
    queryKey: MEMORY_KEY,
    queryFn: () => client.listAgentMemory(),
  });

  if (query.isPending) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  }

  const items = query.data ?? [];
  const manualCount = items.filter((item) => item.manual).length;

  return (
    <div className="flex flex-col gap-7" data-region="agent-memory">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {items.length}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.stats.unit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.stats.total}</p>
        </div>
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {manualCount}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.stats.unit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.stats.manual}</p>
        </div>
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {items.length - manualCount}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.stats.unit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.stats.distilled}</p>
        </div>
      </div>

      {adding ? <AddMemoryForm onDone={onDoneAdding} /> : null}

      {items.length === 0 ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {copy.empty}
        </p>
      ) : (
        KINDS.map((kind) => {
          const rows = items.filter((item) => item.kind === kind);
          if (rows.length === 0) return null;
          return (
            <section key={kind} data-memory-group={kind} aria-label={kindLabel(kind)}>
              <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-1">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 self-center rounded-full ${KIND_DOT[kind]}`}
                />
                <h3 className="text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] text-fg">
                  {kindLabel(kind)}
                </h3>
                <span className="text-[length:var(--text-caption)] tabular-nums text-tertiary">
                  {rows.length}
                </span>
                <span className="ml-auto text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
                  {copy.kindHints[kind]}
                </span>
              </div>
              <div className={ACTIVITY_CARD}>
                <ul className="flex flex-col">
                  {rows.map((item) => (
                    <MemoryRow key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
