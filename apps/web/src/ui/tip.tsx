import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * First hover waits this long. The browser's native `title` tooltip waits
 * about a second, which is why tips go through this component.
 */
export const TIP_OPEN_DELAY_MS = 200;

/** After one tip has opened, the next one inside this window opens immediately. */
const TIP_WARM_MS = 500;

const GAP = 6;
const MARGIN = 8;

let warmUntil = 0;

export function resetTipWarmth(): void {
  warmUntil = 0;
}

export type TipSide = 'top' | 'bottom' | 'left' | 'right';

type Box = { top: number; left: number };

type TriggerProps = {
  disabled?: boolean;
  'aria-describedby'?: string;
};

function mergeDescribed(existing: string | undefined, id: string | undefined): string | undefined {
  const parts = [existing, id].filter((part): part is string =>
    Boolean(part && part.trim() !== ''),
  );
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function atSide(anchor: DOMRect, tip: DOMRect, side: TipSide): Box {
  if (side === 'top') {
    return {
      top: anchor.top - GAP - tip.height,
      left: anchor.left + anchor.width / 2 - tip.width / 2,
    };
  }
  if (side === 'bottom') {
    return {
      top: anchor.bottom + GAP,
      left: anchor.left + anchor.width / 2 - tip.width / 2,
    };
  }
  if (side === 'left') {
    return {
      top: anchor.top + anchor.height / 2 - tip.height / 2,
      left: anchor.left - GAP - tip.width,
    };
  }
  return {
    top: anchor.top + anchor.height / 2 - tip.height / 2,
    left: anchor.right + GAP,
  };
}

function fits(pos: Box, tip: DOMRect): boolean {
  return (
    pos.top >= MARGIN &&
    pos.left >= MARGIN &&
    pos.top + tip.height <= window.innerHeight - MARGIN &&
    pos.left + tip.width <= window.innerWidth - MARGIN
  );
}

export function placeTip(anchor: DOMRect, tip: DOMRect, side: TipSide): Box {
  const opposite: Record<TipSide, TipSide> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const preferred = atSide(anchor, tip, side);
  const flipped = atSide(anchor, tip, opposite[side]);
  const chosen = fits(preferred, tip) ? preferred : fits(flipped, tip) ? flipped : preferred;
  const maxTop = Math.max(MARGIN, window.innerHeight - tip.height - MARGIN);
  const maxLeft = Math.max(MARGIN, window.innerWidth - tip.width - MARGIN);
  return {
    top: Math.min(Math.max(chosen.top, MARGIN), maxTop),
    left: Math.min(Math.max(chosen.left, MARGIN), maxLeft),
  };
}

function boxOf(node: HTMLElement): HTMLElement {
  const child = node.firstElementChild;
  return child instanceof HTMLElement ? child : node;
}

function placeNode(anchor: HTMLElement, tip: HTMLDivElement, side: TipSide): void {
  const next = placeTip(boxOf(anchor).getBoundingClientRect(), tip.getBoundingClientRect(), side);
  tip.style.top = `${next.top}px`;
  tip.style.left = `${next.left}px`;
  tip.style.visibility = 'visible';
}

/**
 * Short hover / keyboard tip. Pass an empty label to render the child alone.
 * Disabled controls are wrapped so the tip still receives the pointer.
 */
export function Tip({
  label,
  side = 'top',
  children,
}: {
  label?: string | null;
  side?: TipSide;
  children: ReactElement;
}) {
  const text = label?.trim() ?? '';
  const tipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useRef(false);
  const [open, setOpen] = useState(false);
  if (text === '' && open) setOpen(false);

  function clearTimer(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function hide(): void {
    clearTimer();
    setOpen(false);
  }

  function show(delay: number): void {
    clearTimer();
    if (text === '') return;
    if (delay <= 0) {
      warmUntil = Date.now() + TIP_WARM_MS;
      setOpen(true);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      warmUntil = Date.now() + TIP_WARM_MS;
      setOpen(true);
    }, delay);
  }

  useEffect(() => {
    return () => clearTimer();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      clearTimer();
      setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    function move(): void {
      const current = anchorRef.current;
      const node = tipRef.current;
      if (!current || !node) return;
      if (!current.isConnected) return;
      placeNode(current, node, side);
    }
    placeNode(anchor, tip, side);
    window.addEventListener('scroll', move, true);
    window.addEventListener('resize', move);
    return () => {
      window.removeEventListener('scroll', move, true);
      window.removeEventListener('resize', move);
    };
  }, [open, text, side]);

  if (text === '') return children;

  const props = children.props as TriggerProps;
  const describedBy = mergeDescribed(props['aria-describedby'], open ? tipId : undefined);
  const child = open
    ? cloneElement(children, { 'aria-describedby': describedBy } as Partial<TriggerProps>)
    : children;

  function crossedBoundary(event: MouseEvent<HTMLElement>): boolean {
    const next = event.relatedTarget;
    return !(next instanceof Node && event.currentTarget.contains(next));
  }

  function onMouseOver(event: MouseEvent<HTMLElement>): void {
    if (!crossedBoundary(event) || touched.current) return;
    show(Date.now() < warmUntil ? 0 : TIP_OPEN_DELAY_MS);
  }

  function onMouseOut(event: MouseEvent<HTMLElement>): void {
    if (!crossedBoundary(event)) return;
    hide();
  }

  function onTouchStart(): void {
    touched.current = true;
    hide();
  }

  function onFocusCapture(event: FocusEvent<HTMLElement>): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches(':focus-visible')) show(0);
  }

  function onBlurCapture(event: FocusEvent<HTMLElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    hide();
  }

  const trigger = (
    <span
      ref={anchorRef}
      className={props.disabled === true ? 'inline-flex max-w-full' : 'contents'}
      onMouseOver={onMouseOver}
      onMouseOut={onMouseOut}
      onMouseDown={hide}
      onTouchStart={onTouchStart}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      {child}
    </span>
  );

  return (
    <>
      {trigger}
      {open
        ? createPortal(
            <div
              ref={tipRef}
              id={tipId}
              role="tooltip"
              style={{ top: 0, left: 0, visibility: 'hidden' }}
              className="pointer-events-none fixed z-[var(--z-tooltip)] w-max max-w-64 rounded-md border border-border bg-elevated px-2 py-1 text-left text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] break-words text-fg shadow-[var(--shadow-xs)]"
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
