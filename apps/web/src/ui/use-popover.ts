import { useEffect, useState, type RefObject } from 'react';

/**
 * Open/close state for a popover whose root wrapper is owned by the caller.
 * Pass a ref created in the component (useRef) and attach it to the wrapper;
 * this hook registers outside-click and Escape listeners while open.
 */
export function usePopover(root: RefObject<HTMLDivElement | null>): {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, root]);

  return {
    open,
    setOpen,
    toggle: () => setOpen((prev) => !prev),
    close: () => setOpen(false),
  };
}
