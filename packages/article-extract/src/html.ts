export function clip(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

export function hostnameOf(raw: string): string | null {
  try {
    return new URL(raw).hostname || null;
  } catch {
    return null;
  }
}

export function parseDim(value: string | null | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function textFromHtml(html: string): string {
  if (html.trim() === '') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}
