/** Strip fragment, lowercase host, drop utm_*, strip trailing slash except `/`. Matches server. */
export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('http(s) URL required');
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  const keep: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    if (!key.toLowerCase().startsWith('utm_')) keep.push([key, value]);
  });
  url.search = '';
  for (const [key, value] of keep) url.searchParams.append(key, value);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function idempotencyKeyForUrl(
  raw: string,
): Promise<{ canonicalUrl: string; key: string }> {
  const canonicalUrl = canonicalizeUrl(raw);
  return { canonicalUrl, key: await sha256Hex(canonicalUrl) };
}
