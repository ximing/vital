import { extractTokens, normalizeTrailingNewlines, renderToken } from './tokens.js';
import type { EntityToken, FillHeadings } from './types.js';

function isH2(line: string, heading: string): boolean {
  const m = /^##[ \t]+(.*)$/.exec(line);
  if (!m) return false;
  return (m[1] ?? '').trim() === heading.trim();
}

function isAtxHeading(line: string, maxLevel: number): boolean {
  const m = /^(#{1,6})(?:[ \t]+|$)/.exec(line);
  if (!m) return false;
  return (m[1] ?? '').length <= maxLevel;
}

export function hasH2(md: string, heading: string): boolean {
  return md.split('\n').some((line) => isH2(line, heading));
}

function splitLines(md: string): string[] {
  const lines = md.split('\n');
  if (md.endsWith('\n') && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function appendH2(md: string, heading: string): string {
  const body = md.replace(/\n+$/, '');
  const block = `## ${heading}`;
  if (body === '') return `${block}\n`;
  return `${body}\n\n${block}\n`;
}

export function ensureFillHeadings(md: string, headings: FillHeadings): string {
  let next = md;
  if (!hasH2(next, headings.tasks)) next = appendH2(next, headings.tasks);
  if (!hasH2(next, headings.inbox)) next = appendH2(next, headings.inbox);
  return normalizeTrailingNewlines(next);
}

function insertUnderH2(md: string, heading: string, tokenLines: string[]): string {
  if (tokenLines.length === 0) return md;
  const lines = splitLines(md);
  let h = lines.findIndex((ln) => isH2(ln, heading));
  if (h < 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`## ${heading}`);
    h = lines.length - 1;
  }
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i += 1) {
    const ln = lines[i];
    if (ln !== undefined && isAtxHeading(ln, 2)) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > h + 1 && lines[insertAt - 1] === '') {
    insertAt -= 1;
  }
  const deleteCount = end - insertAt;
  const chunk: string[] = [];
  if (insertAt === h + 1) chunk.push('');
  chunk.push(...tokenLines);
  chunk.push('');
  lines.splice(insertAt, deleteCount, ...chunk);
  return `${lines.join('\n')}\n`;
}

/** Append only tokens not already present, under the type's task/inbox headings. */
export function insertTokensIdempotent(
  md: string,
  tokens: EntityToken[],
  headings: FillHeadings,
): string {
  const existing = new Set(extractTokens(md).map((t) => `${t.kind}:${t.id}`));
  const missing = tokens.filter((t) => !existing.has(`${t.kind}:${t.id}`));
  const taskLines = missing.filter((t) => t.kind === 'task').map((t) => renderToken('task', t.id));
  const inboxLines = missing
    .filter((t) => t.kind === 'inbox')
    .map((t) => renderToken('inbox', t.id));
  if (taskLines.length === 0 && inboxLines.length === 0) {
    return normalizeTrailingNewlines(md);
  }
  let next = md;
  if (taskLines.length > 0 && !hasH2(next, headings.tasks)) next = appendH2(next, headings.tasks);
  if (inboxLines.length > 0 && !hasH2(next, headings.inbox)) next = appendH2(next, headings.inbox);
  if (taskLines.length > 0) next = insertUnderH2(next, headings.tasks, taskLines);
  if (inboxLines.length > 0) next = insertUnderH2(next, headings.inbox, inboxLines);
  return normalizeTrailingNewlines(next);
}
