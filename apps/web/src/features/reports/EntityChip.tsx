import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { isEntityKind } from '@vital/markdown';
import { t } from '@/copy';
import { chipDeleted, chipLabel, taskChipStatus } from './model';
import { useReportUi } from './report-ui.service';

export function EntityChipView({ node }: NodeViewProps) {
  const kindRaw = node.attrs.kind;
  const idRaw = node.attrs.id;
  const kind = typeof kindRaw === 'string' && isEntityKind(kindRaw) ? kindRaw : 'task';
  const id = typeof idRaw === 'string' ? idRaw : '';
  const embeds = useReportUi((s) => s.embeds);
  const deleted = chipDeleted(kind, id, embeds);
  const fallback = kind === 'task' ? t.reports.chipTask : t.reports.chipInbox;
  const label = deleted ? t.reports.deleted : chipLabel(kind, id, embeds, fallback);
  const status = kind === 'task' ? taskChipStatus(id, embeds) : null;
  const done = status === 'done';

  return (
    <NodeViewWrapper
      as="span"
      className={`vital-chip${deleted ? ' vital-chip-deleted' : ''}${done ? ' vital-chip-done' : ''}`}
      data-kind={kind}
      data-id={id}
      data-vital-entity=""
      contentEditable={false}
    >
      {kind === 'task' ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={t.reports.complete}
          className={`vital-chip-check${done ? ' is-done' : ''}`}
          disabled={deleted || status === 'canceled'}
          data-chip-toggle=""
          onMouseDown={(event) => event.preventDefault()}
        />
      ) : null}
      <span className="vital-chip-label">{label}</span>
    </NodeViewWrapper>
  );
}
