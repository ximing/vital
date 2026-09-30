import { isSafeHref } from '@vital/article-doc';
import { getVitalHost } from '@/host';

export type ArticleLinkClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
};

/**
 * Browser clicks, including Command/Ctrl-click, follow the anchor.
 * The desktop webview drops `target="_blank"` and modifier clicks, so any
 * primary click there — the source URL and links in the article — goes to
 * the system browser when the shell can open it.
 */
export function openArticleLink(event: ArticleLinkClick, href: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.altKey) return;
  const openExternal = getVitalHost()?.openExternal;
  if (!openExternal) return;
  const target = href.trim();
  if (!isSafeHref(target)) return;
  event.preventDefault();
  openExternal(target);
}
