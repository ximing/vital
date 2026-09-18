function htmlDecode(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function originAndPath(src: string): { originPath: string; hostPath: string } | null {
  const match = /^(https?:\/\/)([^/?#]+)(\/[^?#]*)/i.exec(src);
  if (match === null) return null;
  const protocol = match[1] ?? '';
  const host = match[2] ?? '';
  const path = match[3] ?? '';
  return { originPath: `${protocol}${host}${path}`, hostPath: `${host}${path}` };
}

/** Keys used to match a fetched image URL against `<img src>` / `originalSrc`. */
export function imageSrcKeys(src: string): string[] {
  const keys: string[] = [];
  const add = (value: string): void => {
    const next = value.trim();
    if (next !== '' && !keys.includes(next)) keys.push(next);
  };
  add(src);
  add(htmlDecode(src));
  add(src.replace(/#.*$/, ''));
  add(htmlDecode(src.replace(/#.*$/, '')));
  for (const candidate of [...keys]) {
    const parts = originAndPath(candidate);
    if (parts === null) continue;
    add(parts.originPath);
    add(parts.hostPath);
  }
  return keys;
}
