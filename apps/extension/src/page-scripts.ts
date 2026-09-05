/** Injected via chrome.scripting.executeScript — must stay closure-free. */

export function collectPagePayload(): {
  url: string;
  title: string;
  outerHTML: string;
  selection: string;
} {
  return {
    url: location.href,
    title: document.title,
    outerHTML: document.documentElement.outerHTML,
    selection: window.getSelection()?.toString() ?? '',
  };
}

export async function fetchImagesInPage(
  urls: string[],
  maxBytes: number,
  minBytes: number,
): Promise<Array<{ src: string; mime: string; data: number[] }>> {
  const out: Array<{ src: string; mime: string; data: number[] }> = [];
  for (const src of urls) {
    try {
      const res = await fetch(src, { credentials: 'omit' });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < minBytes || buf.byteLength > maxBytes) continue;
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
      out.push({ src, mime, data: [...new Uint8Array(buf)] });
    } catch {
      // CORS / network: skip this image.
    }
  }
  return out;
}

export function showInPageToast(text: string): void {
  const id = 'vital-save-toast';
  document.getElementById(id)?.remove();
  const el = document.createElement('div');
  el.id = id;
  el.setAttribute('role', 'status');
  el.textContent = text;
  el.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'right:16px',
    'bottom:16px',
    'max-width:min(360px,calc(100vw - 32px))',
    'padding:10px 14px',
    'border-radius:10px',
    'background:#0e1a24',
    'color:#ffffff',
    'font:13px/1.4 system-ui,PingFang SC,Noto Sans SC,sans-serif',
    'box-shadow:0 8px 24px rgb(14 26 36 / 28%)',
    'pointer-events:none',
  ].join(';');
  const accent = document.createElement('span');
  accent.style.cssText =
    'display:inline-block;width:6px;height:6px;border-radius:99px;background:#1ab3b0;margin-right:8px;vertical-align:middle';
  el.prepend(accent);
  document.documentElement.appendChild(el);
  window.setTimeout(() => {
    el.remove();
  }, 2800);
}
