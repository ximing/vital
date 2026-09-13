const FALLBACK = '/today';

/** Server push URLs are absolute (`WEB_ORIGIN/...`). Stay inside the SPA / Tauri webview. */
export function appPathFromNotifyUrl(url: string): string {
  if (url === '') return FALLBACK;
  if (!/^https?:\/\//i.test(url)) {
    return url.startsWith('/') ? url : `/${url}`;
  }
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return path === '' ? FALLBACK : path;
  } catch {
    return FALLBACK;
  }
}
