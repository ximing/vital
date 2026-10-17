import {
  findInArticleDoc,
  indexAfterArticleReplace,
  replaceInArticleDoc,
  type ArticleDoc,
  type ArticleFindHit,
} from '@vital/article-doc';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DOC_FIND_EVENT } from '@/lib/doc-find';
import { isShortcutLayerBlocked } from '@/shell/shortcut-guard';
import { DocFindBar } from '@/ui/doc-find-bar';

export type ArticleFindView = {
  hits: ArticleFindHit[];
  current: number;
};

const UNDO_LIMIT = 20;

export function useArticleDocFind({
  id,
  doc,
  root,
  canReplace,
  onReplace,
  onError,
}: {
  id: string;
  doc: ArticleDoc | null;
  root: HTMLElement | null;
  canReplace: boolean;
  onReplace: (doc: ArticleDoc) => Promise<void>;
  onError: (err: unknown) => void;
}): {
  open: boolean;
  doc: ArticleDoc | null;
  view: ArticleFindView | null;
  toggle: () => void;
  bar: ReactNode;
} {
  const [sessionId, setSessionId] = useState(id);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<{ id: string; doc: ArticleDoc } | null>(null);
  const [undoStack, setUndoStack] = useState<ArticleDoc[]>([]);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef(onReplace);
  const errorRef = useRef(onError);

  if (sessionId !== id) {
    setSessionId(id);
    setOpen(false);
    setQuery('');
    setReplacement('');
    setMatchCase(false);
    setIndex(0);
    setBusy(false);
    setOverride(null);
    setUndoStack([]);
  }

  if (override && override.id !== id) setOverride(null);
  if (
    override &&
    override.id === id &&
    doc !== null &&
    (doc === override.doc || JSON.stringify(doc) === JSON.stringify(override.doc))
  ) {
    setOverride(null);
  }

  const shown = override && override.id === id ? override.doc : doc;
  const hits = shown && open ? findInArticleDoc(shown, query, { matchCase }) : [];
  const safeIndex = hits.length === 0 ? 0 : Math.min(index, hits.length - 1);

  useEffect(() => {
    replaceRef.current = onReplace;
    errorRef.current = onError;
  });

  const openFind = useCallback(() => {
    setOpen(true);
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    if (!root) return;
    const onOpen = (): void => openFind();
    root.addEventListener(DOC_FIND_EVENT, onOpen);
    return () => root.removeEventListener(DOC_FIND_EVENT, onOpen);
  }, [openFind, root]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || isShortcutLayerBlocked()) return;
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, root]);

  useEffect(() => {
    if (!open || query === '' || !root) return;
    const frame = window.requestAnimationFrame(() => {
      root
        .querySelector('[data-find-current="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [matchCase, open, query, root, safeIndex, shown]);

  function changeQuery(next: string): void {
    setQuery(next);
    setIndex(0);
  }

  function remember(docToKeep: ArticleDoc): void {
    setUndoStack((stack) => {
      const trimmed = stack.length >= UNDO_LIMIT ? stack.slice(1) : stack;
      return [...trimmed, docToKeep];
    });
  }

  function forget(docToDrop: ArticleDoc): void {
    setUndoStack((stack) => (stack[stack.length - 1] === docToDrop ? stack.slice(0, -1) : stack));
  }

  async function commit(next: ArticleDoc, previous: ArticleDoc | null): Promise<void> {
    if (previous) remember(previous);
    setOverride({ id, doc: next });
    setBusy(true);
    try {
      await replaceRef.current(next);
      setOverride(null);
    } catch (err) {
      if (previous) forget(previous);
      setOverride(null);
      errorRef.current(err);
    } finally {
      setBusy(false);
    }
  }

  function apply(occurrence: number | 'all'): void {
    if (!shown || !canReplace || busy || query === '') return;
    const hit = hits[safeIndex];
    const result = replaceInArticleDoc(shown, query, replacement, { matchCase, occurrence });
    if (result.replaced === 0 || !hit) return;
    if (occurrence === 'all') {
      setIndex(0);
    } else {
      const after = findInArticleDoc(result.doc, query, { matchCase });
      setIndex(indexAfterArticleReplace(after, hit.path, hit.start + replacement.length));
    }
    void commit(result.doc, shown);
  }

  function undo(): void {
    if (busy) return;
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setIndex(0);
    setOverride({ id, doc: prev });
    setBusy(true);
    void replaceRef
      .current(prev)
      .catch((err: unknown) => {
        setUndoStack((stack) => [...stack, prev]);
        setOverride(null);
        errorRef.current(err);
      })
      .finally(() => setBusy(false));
  }

  return {
    open,
    doc: shown,
    view: open && query !== '' && shown ? { hits, current: safeIndex } : null,
    toggle: () => {
      if (open) setOpen(false);
      else openFind();
    },
    bar: open ? (
      <DocFindBar
        query={query}
        replacement={replacement}
        matchCase={matchCase}
        index={safeIndex}
        count={hits.length}
        canReplace={canReplace && shown !== null}
        busy={busy}
        canUndo={undoStack.length > 0}
        findRef={findInputRef}
        onQuery={changeQuery}
        onReplacement={setReplacement}
        onMatchCase={(next) => {
          setMatchCase(next);
          setIndex(0);
        }}
        onPrev={() => {
          if (hits.length === 0) return;
          setIndex((safeIndex - 1 + hits.length) % hits.length);
        }}
        onNext={() => {
          if (hits.length === 0) return;
          setIndex((safeIndex + 1) % hits.length);
        }}
        onReplace={() => apply(safeIndex)}
        onReplaceAll={() => apply('all')}
        onUndo={undo}
        onClose={() => setOpen(false)}
      />
    ) : null,
  };
}
