import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/** jsdom (and first paint before layout) reports 0×0; keep a window so rows still mount. */
const FALLBACK_RECT = { width: 800, height: 600 };

function nearestOverflowY(start: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = start.parentElement;
  while (cur) {
    const { overflowY } = getComputedStyle(cur);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return cur;
    cur = cur.parentElement;
  }
  return null;
}

function offsetTopTo(el: HTMLElement, ancestor: HTMLElement): number {
  const elRect = el.getBoundingClientRect();
  const ancestorRect = ancestor.getBoundingClientRect();
  return elRect.top - ancestorRect.top + ancestor.scrollTop;
}

function watchElementSize(el: Element, cb: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const ro = new ResizeObserver(cb);
  ro.observe(el);
  return () => ro.disconnect();
}

function observeElementRect(
  instance: Virtualizer<HTMLElement, Element>,
  cb: (rect: { width: number; height: number }) => void,
): (() => void) | void {
  const el = instance.scrollElement;
  if (!el) return;
  const emit = () => {
    cb({
      width: el.clientWidth > 0 ? el.clientWidth : FALLBACK_RECT.width,
      height: el.clientHeight > 0 ? el.clientHeight : FALLBACK_RECT.height,
    });
  };
  emit();
  return watchElementSize(el, emit);
}

function measureElement(
  element: Element,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLElement, Element>,
): number {
  const border = entry?.borderBoxSize?.[0]?.blockSize;
  const size =
    border && border > 0 ? border : (element as HTMLElement).getBoundingClientRect().height;
  if (size > 0) return size;
  const index = Number(element.getAttribute('data-index'));
  return Number.isFinite(index) ? instance.options.estimateSize(index) : 0;
}

export function virtualItemStyle(start: number, scrollMargin: number): CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    transform: `translateY(${start - scrollMargin}px)`,
  };
}

export function useScrollVirtualizer<Row extends { key: string }>({
  rows,
  estimateSize,
  overscan = 8,
}: {
  rows: readonly Row[];
  estimateSize: (row: Row) => number;
  overscan?: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return;
    setScrollEl(nearestOverflowY(node) ?? node);
  }, [rows.length]);

  useLayoutEffect(() => {
    const node = listRef.current;
    const parent = scrollEl;
    if (!node || !parent) return;
    const update = () => {
      setScrollMargin(parent === node ? 0 : offsetTopTo(node, parent));
    };
    update();
    const stopNode = watchElementSize(node, update);
    const stopParent = parent === node ? () => undefined : watchElementSize(parent, update);
    return () => {
      stopNode();
      stopParent();
    };
  }, [scrollEl, rows.length]);

  const getItemKey = useCallback(
    (index: number) => rows[index]?.key ?? String(index),
    [rows],
  );
  const estimate = useCallback(
    (index: number) => {
      const row = rows[index];
      return row ? estimateSize(row) : 48;
    },
    [rows, estimateSize],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: estimate,
    getItemKey,
    overscan,
    scrollMargin,
    initialRect: FALLBACK_RECT,
    observeElementRect,
    measureElement,
  });

  return { listRef, virtualizer };
}
