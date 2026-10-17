import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DOC_FIND_EVENT } from '@/lib/doc-find';
import {
  docFindPluginKey,
  findInPmDoc,
  indexAtOrAfter,
  replaceMatchesInTransaction,
  type DocFindState,
} from '@/lib/pm-find';
import { isShortcutLayerBlocked } from '@/shell/shortcut-guard';
import { DocFindBar } from '@/ui/doc-find-bar';

export function usePmDocFind(
  editor: Editor | null,
  editable: boolean,
  root: HTMLElement | null,
): {
  open: boolean;
  toggle: () => void;
  bar: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [index, setIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef(editor);
  const matchCaseRef = useRef(matchCase);
  const matches = editor && open ? findInPmDoc(editor.state.doc, query, matchCase) : [];
  const safeIndex = matches.length === 0 ? 0 : Math.min(index, matches.length - 1);

  useEffect(() => {
    editorRef.current = editor;
    matchCaseRef.current = matchCase;
  });

  const openFind = useCallback(() => {
    const current = editorRef.current;
    if (current) {
      const { from, to } = current.state.selection;
      if (from !== to) {
        const selected = current.state.doc.textBetween(from, to, '\n');
        if (selected !== '' && !selected.includes('\n') && selected.length <= 200) {
          setQuery(selected);
          setIndex(
            indexAtOrAfter(findInPmDoc(current.state.doc, selected, matchCaseRef.current), from),
          );
        }
      }
    }
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
    if (!editor || editor.isDestroyed) return;
    let view: Editor['view'];
    try {
      view = editor.view;
    } catch {
      return;
    }
    const next: DocFindState = {
      query,
      matchCase,
      index: safeIndex,
      active: open && query !== '',
    };
    view.dispatch(editor.state.tr.setMeta(docFindPluginKey, next).setMeta('addToHistory', false));
    const frame = window.requestAnimationFrame(() => {
      view.dom
        .querySelector('[data-find-current="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor, matchCase, open, query, safeIndex]);

  function changeQuery(next: string): void {
    setQuery(next);
    if (!editor) {
      setIndex(0);
      return;
    }
    setIndex(
      indexAtOrAfter(findInPmDoc(editor.state.doc, next, matchCase), editor.state.selection.from),
    );
  }

  function changeMatchCase(next: boolean): void {
    setMatchCase(next);
    if (!editor) return;
    setIndex(
      indexAtOrAfter(findInPmDoc(editor.state.doc, query, next), editor.state.selection.from),
    );
  }

  function step(delta: number): void {
    if (matches.length === 0) return;
    setIndex((safeIndex + delta + matches.length) % matches.length);
  }

  function replaceOne(): void {
    if (!editor || !editable || query === '' || matches.length === 0) return;
    const hit = matches[safeIndex];
    if (!hit) return;
    const tr = editor.state.tr;
    tr.insertText(replacement, hit.from, hit.to);
    const end = hit.from + replacement.length;
    editor.view.dispatch(tr);
    setIndex(indexAtOrAfter(findInPmDoc(editor.state.doc, query, matchCase), end));
  }

  function replaceAll(): void {
    if (!editor || !editable || query === '' || matches.length === 0) return;
    editor.view.dispatch(replaceMatchesInTransaction(editor.state.tr, matches, replacement));
    setIndex(0);
  }

  const canUndo = editable && editor?.can().undo() === true;

  return {
    open,
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
        count={matches.length}
        canReplace={editable}
        canUndo={canUndo}
        findRef={findInputRef}
        onQuery={changeQuery}
        onReplacement={setReplacement}
        onMatchCase={changeMatchCase}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onReplace={replaceOne}
        onReplaceAll={replaceAll}
        onUndo={
          editor
            ? () => {
                editor.chain().undo().run();
              }
            : undefined
        }
        onClose={() => setOpen(false)}
      />
    ) : null,
  };
}
