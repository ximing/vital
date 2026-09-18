/** Decode named + numeric (decimal/hex) character references. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (raw, hex: string) => codePoint(raw, parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (raw, dec: string) => codePoint(raw, parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&bull;/g, '•')
    .replace(/&middot;/g, '·')
    .replace(/&copy;/g, '©')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function codePoint(raw: string, value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return raw;
  return String.fromCodePoint(value);
}

/** Escape text/attr content for HTML output. */
export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
