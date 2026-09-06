import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown, type PmNode } from '@vital/markdown';
import { useEffect, useRef, type MouseEvent } from 'react';
import { t } from '@/copy';
import { markOnboarding } from '@/features/onboarding/mark';
import { VitalEntity } from './entity-extension';
import { withStubEmbed, type SlashHit } from './model';
import { insertChip, slashFromEditor } from './slash';
import { SlashMenu } from './SlashMenu';
import { useReportUi } from './ui-store';

function asPm(md: string): PmNode {
  return parseMarkdownToPmJSON(md);
}

export function WysiwygEditor({
  bodyMd,
  editable,
  onChange,
  onHydrate,
  onToggleTask,
}: {
  bodyMd: string;
  editable: boolean;
  onChange: (md: string) => void;
  onHydrate: (md: string) => void;
  onToggleTask: (id: string) => void;
}) {
  const setSlash = useReportUi((s) => s.setSlash);
  const slash = useReportUi((s) => s.slash);
  const onChangeRef = useRef(onChange);
  const onHydrateRef = useRef(onHydrate);
  const hydrated = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onHydrateRef.current = onHydrate;
  });

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Placeholder.configure({
        placeholder: t.empty.reportEditor,
      }),
      VitalEntity,
    ],
    content: asPm(bodyMd),
    editorProps: {
      attributes: {
        class: 'report-doc tiptap',
        'aria-label': t.reports.body,
        spellcheck: 'true',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && useReportUi.getState().slash) {
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: instance }) => {
      const md = serializePmJSONToMarkdown(instance.getJSON());
      hydrated.current = true;
      onHydrateRef.current(md);
    },
    onUpdate: ({ editor: instance }) => {
      const md = serializePmJSONToMarkdown(instance.getJSON());
      if (hydrated.current) onChangeRef.current(md);
      setSlash(slashFromEditor(instance));
    },
    onSelectionUpdate: ({ editor: instance }) => {
      setSlash(slashFromEditor(instance));
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    return () => setSlash(null);
  }, [setSlash]);

  function pick(hit: SlashHit): void {
    if (!editor) return;
    const current = useReportUi.getState().slash;
    insertChip(editor, current, hit.kind, hit.id);
    useReportUi
      .getState()
      .mergeEmbeds(withStubEmbed({ tasks: {}, inbox: {} }, hit.kind, hit.id, hit.title));
    setSlash(null);
    if (hit.kind === 'task') void markOnboarding({ pinnedTask: true });
  }

  function onClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest('[data-chip-toggle]');
    if (!toggle) return;
    const chip = toggle.closest('[data-kind="task"][data-id]');
    const id = chip?.getAttribute('data-id');
    if (id) onToggleTask(id);
  }

  return (
    <div className="relative" data-testid="report-wysiwyg" onClick={onClick}>
      <EditorContent editor={editor} />
      {slash && editor ? (
        <SlashMenu slash={slash} onPick={pick} onClose={() => setSlash(null)} />
      ) : null}
    </div>
  );
}
