import type { InboxItem } from '@vital/dto';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { moveSelection } from '@/features/todos';
import {
  isComposingEvent,
  isShortcutLayerBlocked,
  isTypingTarget,
} from '@/shell/shortcut-guard';
import { pushShortcutLayer } from '@/shell/shortcut-layer';
import { canPatchStatus } from './model';

export function useInboxKeyboard(opts: {
  ids: string[];
  items: InboxItem[];
  routeId?: string;
  suspended: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  onPaste: () => void;
  onFavorite: (item: InboxItem) => void;
  onArchive: (item: InboxItem) => void;
  onConvert: (item: InboxItem) => void;
  onDelete: (item: InboxItem) => void;
}): string | null {
  const [cursor, setCursor] = useState<string | null>(null);
  const active = opts.routeId ?? cursor;
  const optsRef = useRef(opts);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    optsRef.current = opts;
    activeRef.current = active;
  });

  useEffect(() => {
    if (!opts.routeId) return;
    return pushShortcutLayer(() => optsRef.current.onBack());
  }, [opts.routeId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const current = optsRef.current;
      const selected = activeRef.current;
      if (isComposingEvent(event) || current.suspended || isShortcutLayerBlocked()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) {
        const deleteChord =
          event.key === 'Backspace' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
        if (!deleteChord) return;
        const item = current.items.find((row) => row.id === selected);
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        current.onDelete(item);
        return;
      }
      if (isTypingTarget(event.target)) return;

      if (event.key === 'n') {
        event.preventDefault();
        current.onPaste();
        return;
      }
      if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        if (!current.routeId) return;
        event.preventDefault();
        setCursor(current.routeId);
        current.onBack();
        return;
      }
      if (
        event.key === 'j' ||
        event.key === 'k' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp'
      ) {
        event.preventDefault();
        const next = moveSelection(
          current.ids,
          selected,
          event.key === 'j' || event.key === 'ArrowDown' ? 1 : -1,
        );
        if (next === null) return;
        if (current.routeId) current.onOpen(next);
        else setCursor(next);
        return;
      }
      if (event.key === 'Enter' || event.key === 'ArrowRight') {
        if (!selected || current.routeId) return;
        event.preventDefault();
        current.onOpen(selected);
        return;
      }
      const item = current.items.find((row) => row.id === selected);
      if (!item) return;
      if (event.key === 'f' && canPatchStatus(item)) {
        event.preventDefault();
        current.onFavorite(item);
        return;
      }
      if (event.key === 'a' && canPatchStatus(item)) {
        event.preventDefault();
        current.onArchive(item);
        return;
      }
      if (event.key === 'c' && item.status !== 'converted') {
        event.preventDefault();
        current.onConvert(item);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return opts.routeId ? null : cursor;
}
