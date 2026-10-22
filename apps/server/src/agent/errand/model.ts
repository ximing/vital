import { createHash } from 'node:crypto';
import type { AgentJobPayload } from '../../db/schema.js';
import { AppError } from '../../errors.js';
import { DeferredAgentJobError } from '../job-runtime.js';

/** Worker scan must not enqueue this. Chat, the inbox button, and draft upgrade do. */
export const ERRAND_JOB_TYPE = 'errand.run' as const;

export const ERRAND_MODEL_CALL_LIMIT = 3;

export const ORGANIZE_BATCH = 20;

export const ORGANIZE_MAX_IDS = 80;

export const PROMPT_BODY_CHARS = 8_000;

const EXCERPT_CHARS = 500;

const NOTE_CHARS = 50_000;

const NOTIFY_CHARS = 400;

export const ERRAND_DONE_TITLE = '代办完成';

export const ERRAND_FAILED_TITLE = '代办没完成';

export type ErrandKind = 'inbox.read_summarize' | 'inbox.organize';

export const FAIL_TEXT = {
  'no-body': '代办没有完成：这篇没有正文，没法总结。',
  'no-model': '代办没有完成：没有可用的模型。',
  'model-failed': '代办没有完成：模型没有完成这次代办。',
  empty: '代办没有完成：模型没有给出摘要。',
  'missing-item': '代办没有完成：这篇收集箱条目不在了。',
  'no-items': '代办没有完成：没有可整理的收集箱条目。',
  'bad-plan': '代办没有完成：模型没有给出整理方案。',
  propose: '代办没有完成：模型调用会超过 3 次，已改成提案，需要你来处理。',
} as const;

export type ErrandFailCode = keyof typeof FAIL_TEXT;

/** Test seam: pretend this many model calls already happened in the errand. */
let callsAlreadyUsed = 0;

export function setErrandCallsAlreadyUsed(n: number): void {
  callsAlreadyUsed = n;
}

export function resetErrandForTests(): void {
  callsAlreadyUsed = 0;
}

export function organizeModelCalls(itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.ceil(itemCount / ORGANIZE_BATCH);
}

export function errandWouldExceed(needed: number, alreadyUsed = callsAlreadyUsed): boolean {
  return alreadyUsed + needed > ERRAND_MODEL_CALL_LIMIT;
}

export function readDedupKey(userId: string, inboxItemId: string): string {
  return `errand.run:read:${userId}:${inboxItemId}`;
}

export function organizeDedupKey(userId: string, ids: readonly string[]): string {
  const hash = createHash('sha256')
    .update([...ids].sort().join(','))
    .digest('hex')
    .slice(0, 32);
  return `errand.run:organize:${userId}:${hash}`;
}

export function errandSourceMarker(inboxItemId: string): string {
  return `<!-- errand-source:inbox:${inboxItemId} -->`;
}

export function errandReadMarker(inboxItemId: string): string {
  return `<!-- errand:read:${inboxItemId} -->`;
}

export function errandOrganizeMarker(taskId: string): string {
  return `<!-- errand:organize:${taskId} -->`;
}

export function failMarker(code: ErrandFailCode, taskId: string): string {
  return `<!-- errand:fail:${code}:${taskId} -->`;
}

export function proposeMarker(taskId: string): string {
  return `<!-- errand:propose:${taskId} -->`;
}

export function appendErrandNote(notes: string, marker: string, block: string): string | null {
  if (notes.includes(marker)) return null;
  const base = notes.trimEnd();
  const next = `${base}${base === '' ? '' : '\n\n'}${marker}\n${block}`;
  return next.slice(0, NOTE_CHARS);
}

/** Exactly three lines when the model cooperates. Never invents a line. */
export function threeLineSummary(raw: string): string | null {
  const cleaned = raw.replace(/```[\s\S]*?```/g, ' ').trim();
  let lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  lines = lines
    .map((line) => line.replace(/^[#>*\-\d.、\s]+/, '').trim())
    .filter((line) => line !== '');
  const onlyLine = lines.length === 1 ? lines[0] : undefined;
  if (onlyLine !== undefined) {
    const parts = onlyLine
      .split(/(?<=[。！？])/)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    if (parts.length > 1) lines = parts;
  }
  if (lines.length === 0) return null;
  const summary = lines.slice(0, 3).join('\n');
  return summary.length <= EXCERPT_CHARS ? summary : summary.slice(0, EXCERPT_CHARS);
}

export interface OrganizePlanItem {
  id: string;
  archive: boolean;
  addTags: string[];
}

export interface OrganizePlan {
  note: string;
  items: OrganizePlanItem[];
}

export function parseOrganizePlan(raw: string, allowed: ReadonlySet<string>): OrganizePlan | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let body: unknown;
  try {
    body = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const note = typeof record['note'] === 'string' ? record['note'].trim().slice(0, 2000) : '';
  const rows = Array.isArray(record['items']) ? record['items'] : [];
  const items: OrganizePlanItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const id = typeof item['id'] === 'string' ? item['id'] : '';
    if (!allowed.has(id)) continue;
    const addTags = Array.isArray(item['addTags'])
      ? item['addTags']
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim().slice(0, 40))
          .filter((tag) => tag !== '')
          .slice(0, 8)
      : [];
    items.push({ id, archive: item['archive'] === true, addTags });
  }
  if (note === '' && items.length === 0) return null;
  return { note, items };
}

type ErrandPayload = AgentJobPayload & {
  taskId: string;
  kind: ErrandKind;
  inboxItemId?: string;
  inboxItemIds?: string[];
};

export function isErrandPayload(payload: AgentJobPayload): payload is ErrandPayload {
  if (!('taskId' in payload) || typeof payload.taskId !== 'string') return false;
  if (!('kind' in payload)) return false;
  const kind: string = payload.kind;
  return kind === 'inbox.read_summarize' || kind === 'inbox.organize';
}

export interface ErrandStart {
  taskId: string;
  jobId: string | null;
}

export function isModelError(err: unknown): boolean {
  if (err instanceof DeferredAgentJobError) return true;
  return err instanceof AppError && err.code.startsWith('LLM_');
}

export function clipNotify(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= NOTIFY_CHARS ? trimmed : `${trimmed.slice(0, NOTIFY_CHARS - 1)}…`;
}
