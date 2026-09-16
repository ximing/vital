function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function escapeParagraph(text: string): string {
  return `<p>${escapeXml(text)}</p>`;
}

export function textToHtml(text: string): string {
  return escapeXml(text)
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replaceAll('\n', '<br>')}</p>`)
    .join('');
}
