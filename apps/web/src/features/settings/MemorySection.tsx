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
    <span className="flex flex-wrap gap-1" data-memory-scope={scope.join(',')}>
      {scope.map((value) => (
        <span
          key={value}
          className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted"
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
    <span className="flex flex-wrap gap-1" role="group" aria-label={copy.scope}>
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
                ? 'bg-accent-subtle text-fg'
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
      <li
        data-memory-row={item.id}
        data-memory-kind={item.kind}
        className="flex flex-col gap-2 border-b border-border py-2.5 last:border-b-0"
      >
        <textarea
          aria-label={copy.content}
          rows={2}
          maxLength={300}
          className={`${FIELD_CONTROL_CLASS} h-auto w-full py-2`}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
        <ScopePicker scope={scope} onToggle={(value) => setScope(toggleScope(scope, value))} />
        <span className="flex gap-1.5">
          <button
            type="button"
            disabled={patch.isPending || content.trim() === ''}
            onClick={() => patch.mutate({ content: content.trim(), scope: scope as AgentMemoryScopeValue[] })}
            className="inline-flex h-6 items-center rounded-full bg-accent-subtle px-2.5 text-[11px] font-medium text-fg transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.save}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            {copy.cancel}
          </button>
        </span>
      </li>
    );
  }

  return (
    <li
      data-memory-row={item.id}
      data-memory-kind={item.kind}
      data-memory-manual={item.manual ? 'true' : 'false'}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border py-2.5 last:border-b-0"
    >
      <span className="min-w-0 flex-1 whitespace-pre-wrap text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg">
        {item.content}
      </span>
      <ScopeChips scope={item.scope} />
      {item.manual ? (
        <span
          data-memory-manual-badge
          className="shrink-0 rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] font-medium text-fg"
        >
          {copy.manualBadge}
        </span>
      ) : null}
      <span className="shrink-0 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
        {copy.sourceCount} {item.sourceCount}
      </span>
      <span className="flex gap-1.5">
        <button
          type="button"
          onClick={startEdit}
          className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
        >
          {copy.edit}
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
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
    <div data-region="memory-add" className="flex flex-col gap-2 rounded-[18px] border border-border bg-surface-muted px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {copy.kind}
        </span>
        <select
          aria-label={copy.kind}
          value={kind}
          onChange={(event) => setKind(event.target.value as AgentMemoryKind)}
          className={`${FIELD_CONTROL_CLASS} h-8 w-auto py-0 pr-8`}
        >
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {kindLabel(value)}
            </option>
          ))}
        </select>
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
      <span className="flex gap-1.5">
        <button
          type="button"
          disabled={create.isPending || content.trim() === ''}
          onClick={() => create.mutate()}
          className="inline-flex h-7 items-center rounded-full bg-accent-subtle px-3 text-[length:var(--text-meta)] font-medium text-fg transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copy.submit}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-7 items-center rounded-full px-3 text-[length:var(--text-meta)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
        >
          {copy.cancel}
        </button>
      </span>
    </div>
  );
}

export function MemorySection() {
  const query = useQuery({
    queryKey: MEMORY_KEY,
    queryFn: () => client.listAgentMemory(),
  });
  const [adding, setAdding] = useState(false);

  if (query.isPending) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  }

  const items = query.data ?? [];

  return (
    <div className="flex flex-col gap-5" data-region="agent-memory">
      <div>
        {adding ? (
          <AddMemoryForm onDone={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-3 text-[length:var(--text-meta)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            + {copy.add}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {copy.empty}
        </p>
      ) : (
        KINDS.map((kind) => {
          const rows = items.filter((item) => item.kind === kind);
          if (rows.length === 0) return null;
          return (
            <div key={kind} data-memory-group={kind}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-tertiary">
                {kindLabel(kind)} · {rows.length}
              </p>
              <ul className="mt-1 flex flex-col">
                {rows.map((item) => (
                  <MemoryRow key={item.id} item={item} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
