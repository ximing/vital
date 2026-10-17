const FALLBACK = '/today';

/** A protocol-relative path (`//host`) would leave the page origin. */
function appPath(path: string): string {
  if (path === '' || !path.startsWith('/') || path.startsWith('//')) return FALLBACK;
  return path;
}

/** Server push URLs may be absolute (`WEB_ORIGIN/...`). Stay inside the SPA / Tauri webview. */
export function appPathFromNotifyUrl(url: string): string {
  if (url === '') return FALLBACK;
  if (url.startsWith('//')) return FALLBACK;
  if (!/^https?:\/\//i.test(url)) {
    return appPath(url.startsWith('/') ? url : `/${url}`);
  }
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return appPath(path);
  } catch {
    return FALLBACK;
  }
}
