/** Facets memory.distill may write into agent_memory scope `profile`. */
export const RHYTHM_FACETS = ['peak_hours', 'low_weekday', 'task_grain', 'defer_theme'] as const;
export type RhythmFacet = (typeof RHYTHM_FACETS)[number];

export interface RhythmMemoryBody {
  facet: RhythmFacet;
  text: string;
  /** Minutes from local midnight. Present on peak_hours. End is exclusive. */
  startMin?: number;
  endMin?: number;
  /** Luxon weekday, Monday = 1 … Sunday = 7. Present on low_weekday. */
  weekday?: number;
  /** Rounded average estimate. Present on task_grain. */
  minutes?: number;
}

const FACET = 'peak_hours|low_weekday|task_grain|defer_theme';
const BODY = new RegExp(`^\\[rhythm:(${FACET})(?:\\s+([^\\]]*))?\\]\\s*([\\s\\S]+)$`);

function isFacet(value: string): value is RhythmFacet {
  return (RHYTHM_FACETS as readonly string[]).includes(value);
}

function attr(source: string, name: string): number | undefined {
  const match = new RegExp(`(?:^|\\s)${name}=(\\d+)`).exec(source);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Parse a profile row. Returns null when the prefix or sentence is missing. */
export function parseRhythmMemory(content: string): RhythmMemoryBody | null {
  const match = BODY.exec(content.trim());
  if (!match?.[1] || !match[3]) return null;
  if (!isFacet(match[1])) return null;
  const text = match[3].trim();
  if (text === '') return null;
  const attrs = match[2] ?? '';
  const body: RhythmMemoryBody = { facet: match[1], text };
  const startMin = attr(attrs, 'start');
  const endMin = attr(attrs, 'end');
  if (startMin !== undefined && endMin !== undefined && endMin > startMin) {
    body.startMin = startMin;
    body.endMin = endMin;
  }
  const weekday = attr(attrs, 'weekday');
  if (weekday !== undefined && weekday >= 1 && weekday <= 7) body.weekday = weekday;
  const minutes = attr(attrs, 'minutes');
  if (minutes !== undefined && minutes > 0) body.minutes = minutes;
  return body;
}

export function isRhythmMemoryScope(scope: readonly string[]): boolean {
  return scope.includes('profile');
}
