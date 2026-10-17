import { isTypingTarget } from '@/shell/shortcut-guard';

/** Fired on a `[data-doc-find]` root to open in-document find. */
export const DOC_FIND_EVENT = 'vital:doc-find';

export function isDocFindChord(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  return event.key === 'f' || event.key === 'F';
}

/**
 * The document that should take ⌘F / Ctrl+F.
 * Focus inside a document wins. Otherwise the page document (reader or report)
 * wins when the user is not typing in another field.
 */
export function docFindRootFor(target: EventTarget | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (target instanceof Element) {
    const inside = target.closest('[data-doc-find]');
    if (inside instanceof HTMLElement) {
      const inFindBar = target.closest('[data-testid="doc-find"]') !== null;
      const inEditor =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('[contenteditable="true"], [contenteditable=""]') !== null);
      if (isTypingTarget(target) && !inFindBar && !inEditor) return null;
      return inside;
    }
  }
  if (isTypingTarget(target)) return null;
  const page = document.querySelector('[data-doc-find="page"]');
  return page instanceof HTMLElement ? page : null;
}
