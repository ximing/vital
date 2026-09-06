import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown, type PmNode } from '@vital/markdown';
import { Bold, Heading2, List } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import { markOnboarding } from '@/features/onboarding/mark';
import { VitalEntity } from './entity-extension';
import { withStubEmbed, type SlashHit } from './model';
import { insertChip, slashFromEditor } from './slash';
import { SlashMenu } from './SlashMenu';
import { reportUi, useReportUi } from './report-ui.service';

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
  const [, bump] = useState(0);

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
        if (event.key === 'Enter' && reportUi().slash) {
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
      bump((n) => n + 1);
    },
    onTransaction: () => bump((n) => n + 1),
  });

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    return () => setSlash(null);
  }, [setSlash]);

  function pick(hit: SlashHit): void {
    if (!editor) return;
    const current = reportUi().slash;
    insertChip(editor, current, hit.kind, hit.id);
    reportUi().mergeEmbeds(withStubEmbed({ tasks: {}, inbox: {} }, hit.kind, hit.id, hit.title));
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
      <div className="mb-3 flex items-center gap-1">
        <ToolbarBtn
          label="粗体"
          active={editor?.isActive('bold') === true}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Icon icon={Bold} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="小标题"
          active={editor?.isActive('heading', { level: 2 }) === true}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Icon icon={Heading2} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="列表"
          active={editor?.isActive('bulletList') === true}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <Icon icon={List} size={14} />
        </ToolbarBtn>
      </div>
      <EditorContent editor={editor} />
      {slash && editor ? (
        <SlashMenu slash={slash} onPick={pick} onClose={() => setSlash(null)} />
      ) : null}
    </div>
  );
}

function ToolbarBtn({
  children,
  active,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
        active ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
