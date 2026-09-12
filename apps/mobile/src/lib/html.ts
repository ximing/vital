/** Decode named + numeric (decimal/hex) character references. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (raw, hex: string) => codePoint(raw, parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (raw, dec: string) => codePoint(raw, parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
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

/** RN reader has no WebView: flatten HTML to text (spec §10.5). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '· ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function looksLikeMarkdown(text: string): boolean {
  return /(?:^|\n)#{1,3} |\*\*|^\s*[-*] /m.test(text);
}
