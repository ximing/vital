import type { EntityKind, EntityToken } from '@vital/markdown';
import type { ReportEmbeds } from '@vital/dto';
import { copy } from '../../lib/copy';

export function chipLabel(token: Pick<EntityToken, 'kind' | 'id'>, embeds: ReportEmbeds): string {
  if (token.kind === 'task') {
    const hit = embeds.tasks[token.id];
    if (hit === undefined) return copy.chipTask;
    if (hit.deletedAt !== null) return `${hit.title} · ${copy.deleted}`;
    return hit.title;
  }
  const hit = embeds.inbox[token.id];
  if (hit === undefined) return copy.chipInbox;
  if (hit.deletedAt !== null) return `${hit.title} · ${copy.deleted}`;
  return hit.title;
}

export function chipShowsBraces(label: string): boolean {
  return label.includes('[[') || label.includes(']]');
}

export function pinKindColor(
  kind: EntityKind,
  colors: { accentPrimary: string; reportWeekly: string },
): string {
  return kind === 'task' ? colors.accentPrimary : colors.reportWeekly;
}
