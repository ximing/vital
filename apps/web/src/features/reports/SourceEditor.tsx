import { renderToken } from '@vital/markdown';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/copy';
import {
  insertEntityToken,
  slashFromText,
  withStubEmbed,
  type SlashHit,
  type SlashQuery,
} from './model';
import { SlashMenu } from './SlashMenu';
import { useReportUi } from './ui-store';

export function SourceEditor({
  value,
  editable,
  onChange,
}: {
  value: string;
  editable: boolean;
  onChange: (md: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  const mergeEmbedsStore = useReportUi((s) => s.mergeEmbeds);

  function readSlash(text: string, cursor: number): void {
    setSlash(slashFromText(text, cursor));
  }

  function pick(hit: SlashHit): void {
    const el = ref.current;
    if (!el || !slash) return;
    const next = insertEntityToken(value, slash.from, slash.to, hit.kind, hit.id);
    onChange(next);
    mergeEmbedsStore(withStubEmbed({ tasks: {}, inbox: {} }, hit.kind, hit.id, hit.title));
    const cursor = slash.from + renderToken(hit.kind, hit.id).length;
    setSlash(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.value !== value) {
      const start = el.selectionStart;
      el.value = value;
      el.setSelectionRange(start, start);
    }
  }, [value]);

  return (
    <div className="relative">
      <textarea
        ref={ref}
        data-testid="report-source"
        aria-label={t.reports.body}
        defaultValue={value}
        disabled={!editable}
        className="report-source min-h-[28rem] w-full resize-y bg-transparent text-fg outline-none"
        onChange={(event) => {
          onChange(event.target.value);
          readSlash(event.target.value, event.target.selectionStart);
        }}
        onSelect={(event) => {
          const el = event.currentTarget;
          readSlash(el.value, el.selectionStart);
        }}
        onKeyUp={(event) => {
          const el = event.currentTarget;
          readSlash(el.value, el.selectionStart);
        }}
      />
      {slash ? <SlashMenu slash={slash} onPick={pick} onClose={() => setSlash(null)} /> : null}
    </div>
  );
}
