import { useEffect, useRef, useState } from 'react';
import { moveSelection } from '@/features/todos/keyboard';
import {
  isComposingEvent,
  isShortcutLayerBlocked,
  isTypingTarget,
} from '@/shell/shortcut-guard';
import { pushShortcutLayer } from '@/shell/shortcut-layer';

export function useDaysKeyboard(opts: {
  ids: string[];
  editing: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}): string | null {
  const [cursor, setCursor] = useState<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  useEffect(() => {
    if (!opts.editing) return;
    return pushShortcutLayer(() => optsRef.current.onClose());
  }, [opts.editing]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const current = optsRef.current;
      if (isComposingEvent(event)) return;
      if (current.editing) {
        if (isTypingTarget(event.target) || isShortcutLayerBlocked()) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
          event.preventDefault();
          current.onClose();
        }
        return;
      }
      if (isShortcutLayerBlocked() || isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'n') {
        event.preventDefault();
        current.onCreate();
        return;
      }
      if (
        event.key === 'j' ||
        event.key === 'k' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp'
      ) {
        event.preventDefault();
        setCursor(
          moveSelection(
            current.ids,
            cursorRef.current,
            event.key === 'j' || event.key === 'ArrowDown' ? 1 : -1,
          ),
        );
        return;
      }
      const selected = cursorRef.current;
      if ((event.key === 'Enter' || event.key === 'ArrowRight') && selected) {
        event.preventDefault();
        current.onOpen(selected);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return cursor;
}
