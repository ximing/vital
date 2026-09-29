/** True when the stored title is still the URL the user pasted, not a name they typed. */
export function titleIsPlaceholder(title: string, originalUrl: string): boolean {
  const trimmed = title.trim();
  if (trimmed === '') return true;
  let url: URL;
  try {
    url = new URL(originalUrl);
  } catch {
    return trimmed === originalUrl.trim();
  }
  const bare = trimmed.replace(/\/+$/, '');
  const href = url.href.replace(/\/+$/, '');
  const origin = `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  return (
    trimmed === originalUrl.trim() ||
    trimmed === url.href ||
    trimmed === url.hostname ||
    trimmed === url.host ||
    bare === href ||
    bare === origin
  );
}
