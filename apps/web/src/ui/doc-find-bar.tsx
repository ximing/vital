import { CaseSensitive, ChevronDown, ChevronUp, Undo2, X } from 'lucide-react';
import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';

const INPUT_CLASS =
  'h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg shadow-[var(--shadow-xs)] outline-none placeholder:text-muted focus:border-focus focus:bg-elevated focus:shadow-[0_0_0_3px_var(--focus-ring)]';

export function DocFindBar({
  query,
  replacement,
  matchCase,
  index,
  count,
  canReplace,
  busy = false,
  canUndo = false,
  findRef,
  onQuery,
  onReplacement,
  onMatchCase,
  onPrev,
  onNext,
  onReplace,
  onReplaceAll,
  onUndo,
  onClose,
}: {
  query: string;
  replacement: string;
  matchCase: boolean;
  index: number;
  count: number;
  canReplace: boolean;
  busy?: boolean;
  canUndo?: boolean;
  findRef?: Ref<HTMLInputElement>;
  onQuery: (value: string) => void;
  onReplacement: (value: string) => void;
  onMatchCase: (value: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onUndo?: () => void;
  onClose: () => void;
}) {
  const findId = useId();
  const replaceId = useId();
  const composing = useRef(false);
  const [findDraft, setFindDraft] = useState(query);
  const [seenQuery, setSeenQuery] = useState(query);
  if (query !== seenQuery) {
    setSeenQuery(query);
    setFindDraft(query);
  }
  const noHits = query !== '' && count === 0;
  const replaceDisabled = !canReplace || busy || count === 0 || query === '';

  function onFindKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) onPrev();
      else onNext();
    }
  }

  function onReplaceKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!replaceDisabled) onReplace();
    }
  }

  return (
    <div
      role="search"
      aria-label={t.docFind.label}
      data-testid="doc-find"
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-elevated p-2 shadow-[var(--shadow-xs)]"
    >
      <div className="flex items-center gap-1">
        <label htmlFor={findId} className="sr-only">
          {t.docFind.find}
        </label>
        <input
          id={findId}
          ref={findRef}
          value={findDraft}
          placeholder={t.docFind.find}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={INPUT_CLASS}
          onChange={(event) => {
            const next = event.target.value;
            setFindDraft(next);
            if (!composing.current) onQuery(next);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            setFindDraft(event.currentTarget.value);
            onQuery(event.currentTarget.value);
          }}
          onKeyDown={onFindKey}
        />
        <span
          aria-live="polite"
          className="w-14 shrink-0 text-center text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted tabular-nums"
        >
          {query === '' ? '' : noHits ? t.docFind.none : progress(index + 1, count)}
        </span>
        <FindIconButton label={t.docFind.prev} disabled={count === 0} onClick={onPrev}>
          <Icon icon={ChevronUp} size={14} />
        </FindIconButton>
        <FindIconButton label={t.docFind.next} disabled={count === 0} onClick={onNext}>
          <Icon icon={ChevronDown} size={14} />
        </FindIconButton>
        <FindIconButton
          label={t.docFind.matchCase}
          pressed={matchCase}
          onClick={() => onMatchCase(!matchCase)}
        >
          <Icon icon={CaseSensitive} size={14} />
        </FindIconButton>
        {onUndo && canUndo ? (
          <FindIconButton label={t.docFind.undo} disabled={busy} onClick={onUndo}>
            <Icon icon={Undo2} size={14} />
          </FindIconButton>
        ) : null}
        <FindIconButton label={t.docFind.close} onClick={onClose}>
          <Icon icon={X} size={14} />
        </FindIconButton>
      </div>
      <div className="flex items-center gap-1">
        <label htmlFor={replaceId} className="sr-only">
          {t.docFind.replace}
        </label>
        <input
          id={replaceId}
          value={replacement}
          placeholder={t.docFind.replace}
          disabled={!canReplace || busy}
          className={INPUT_CLASS}
          onChange={(event) => onReplacement(event.target.value)}
          onKeyDown={onReplaceKey}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={replaceDisabled}
          loading={busy}
          onClick={onReplace}
        >
          {t.docFind.replaceOne}
        </Button>
        <Button size="sm" variant="quiet" disabled={replaceDisabled} onClick={onReplaceAll}>
          {t.docFind.replaceAll}
        </Button>
      </div>
    </div>
  );
}

function progress(current: number, total: number): string {
  return t.docFind.progress.replace('{current}', String(current)).replace('{total}', String(total));
}

function FindIconButton({
  label,
  pressed = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed || undefined}
      disabled={disabled}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
        disabled
          ? 'text-muted/40'
          : pressed
            ? 'bg-accent-subtle text-fg'
            : 'text-muted hover:bg-surface-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
