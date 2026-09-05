import { isEntityKind, type EntityKind, type EntityToken, type RenderPart } from './types.js';

/**
 * UUID versions 1–8, RFC variant 8/9/a/b. Spec §10.6; `i` so stored uppercase still matches.
 */
export const ENTITY_TOKEN_SOURCE =
  '\\[\\[(task|inbox):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\]\\]';

export function entityTokenGlobalRe(): RegExp {
  return new RegExp(ENTITY_TOKEN_SOURCE, 'gi');
}

export function parseEntityToken(raw: string): EntityToken | null {
  const re = new RegExp(`^${ENTITY_TOKEN_SOURCE}$`, 'i');
  const m = re.exec(raw);
  const kindRaw = m?.[1];
  const id = m?.[2];
  if (kindRaw === undefined || id === undefined) return null;
  const kind = kindRaw.toLowerCase();
  if (!isEntityKind(kind)) return null;
  return { kind, id: id.toLowerCase(), start: 0, end: raw.length };
}

export function renderToken(kind: EntityKind, id: string): `[[${EntityKind}:${string}]]` {
  return `[[${kind}:${id}]]`;
}

export function extractTokens(md: string): EntityToken[] {
  const re = entityTokenGlobalRe();
  const out: EntityToken[] = [];
  for (const m of md.matchAll(re)) {
    const kindRaw = m[1];
    const id = m[2];
    if (kindRaw === undefined || id === undefined) continue;
    const kind = kindRaw.toLowerCase();
    if (!isEntityKind(kind)) continue;
    const start = m.index;
    out.push({
      kind,
      id: id.toLowerCase(),
      start,
      end: start + m[0].length,
    });
  }
  return out;
}

export function splitForRender(md: string): RenderPart[] {
  const re = entityTokenGlobalRe();
  const parts: RenderPart[] = [];
  let last = 0;
  for (const m of md.matchAll(re)) {
    const start = m.index;
    if (start > last) {
      parts.push({ type: 'text', value: md.slice(last, start) });
    }
    const kindRaw = m[1];
    const id = m[2];
    if (kindRaw !== undefined && id !== undefined) {
      const kind = kindRaw.toLowerCase();
      if (isEntityKind(kind)) {
        parts.push({
          type: 'entity',
          token: { kind, id: id.toLowerCase(), start, end: start + m[0].length },
        });
      }
    }
    last = start + m[0].length;
  }
  if (last < md.length) {
    parts.push({ type: 'text', value: md.slice(last) });
  }
  return parts;
}

export function normalizeTrailingNewlines(md: string): string {
  if (md === '') return '';
  return md.replace(/\n+$/, '\n');
}
