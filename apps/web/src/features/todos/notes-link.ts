import { isSafeHref } from '@vital/article-doc';
import { getVitalHost } from '@/host';

export type NoteLinkClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
};

/** Href of the anchor under a click, if the event landed on a link. */
export function hrefFromLinkClick(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const href = el?.closest('a')?.getAttribute('href');
  if (href == null) return null;
  const trimmed = href.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Command/Ctrl + primary click opens a task-note link.
 * A plain click still places the caret.
 * The desktop webview drops modifier clicks, so the shell opens the system browser.
 * A normal browser opens a new tab.
 */
export function openTaskNoteLink(event: NoteLinkClick, href: string): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.altKey) return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  const target = href.trim();
  if (!isSafeHref(target)) return false;
  event.preventDefault();
  const openExternal = getVitalHost()?.openExternal;
  if (openExternal) {
    openExternal(target);
    return true;
  }
  window.open(target, '_blank', 'noopener,noreferrer');
  return true;
}
