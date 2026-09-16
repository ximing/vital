import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

const TONE_CLASS = {
  scrim: 'bg-[color:var(--scrim)]',
  dim: 'bg-fg/25',
  transparent: '',
} as const;

const ALIGN_CLASS = {
  center: 'flex items-center justify-center',
  start: 'flex items-start justify-center',
  end: 'flex justify-end',
  none: '',
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex !== -1 && !el.hasAttribute('disabled'),
  );
}

export function Overlay({
  children,
  className = '',
  tone = 'transparent',
  align = 'none',
  onClose,
  closeOnBackdrop = false,
  closeOnEscape = false,
  closeOnContextMenu = false,
  backdropEvent = 'click',
  lockFocus = false,
  restoreFocus = false,
}: {
  children: ReactNode;
  className?: string;
  tone?: keyof typeof TONE_CLASS;
  align?: keyof typeof ALIGN_CLASS;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  closeOnContextMenu?: boolean;
  backdropEvent?: 'click' | 'mousedown';
  lockFocus?: boolean;
  restoreFocus?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (lockFocus) {
      const root = rootRef.current;
      const first = root ? focusableIn(root)[0] : undefined;
      (first ?? root)?.focus();
    }
    return () => {
      if (restoreFocus) previousFocus.current?.focus();
    };
  }, [lockFocus, restoreFocus]);

  useEffect(() => {
    if (!closeOnEscape || !onClose) return;
    const close = onClose;
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOnEscape, onClose]);

  function onBackdrop(event: MouseEvent<HTMLDivElement>): void {
    if (!closeOnBackdrop || !onClose) return;
    if (event.target === event.currentTarget) onClose();
  }

  function onTab(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!lockFocus || event.key !== 'Tab') return;
    const root = rootRef.current;
    if (!root) return;
    const items = focusableIn(root);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      tabIndex={lockFocus ? -1 : undefined}
      className={`fixed inset-0 z-[var(--z-overlay)] ${TONE_CLASS[tone]} ${ALIGN_CLASS[align]} ${className}`}
      onClick={backdropEvent === 'click' ? onBackdrop : undefined}
      onMouseDown={backdropEvent === 'mousedown' ? onBackdrop : undefined}
      onContextMenu={
        closeOnContextMenu
          ? (event) => {
              event.preventDefault();
              onClose?.();
            }
          : undefined
      }
      onKeyDown={lockFocus ? onTab : undefined}
    >
      {children}
    </div>
  );
}
