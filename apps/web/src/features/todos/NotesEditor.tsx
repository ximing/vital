import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown, type PmNode } from '@vital/markdown';
import { Bold, Heading2, List } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';

function asPm(md: string): PmNode {
  return parseMarkdownToPmJSON(md);
}

export function NotesEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (md: string) => void;
}) {
  const onChangeRef = useRef(onChange);
  const skip = useRef(true);
  const [, bump] = useState(0);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2] } }),
      Placeholder.configure({ placeholder: t.todos.notesPlaceholder }),
    ],
    content: asPm(value),
    editorProps: {
      attributes: {
        class: 'task-notes-doc tiptap',
        'aria-label': t.todos.notes,
      },
    },
    onCreate: () => {
      skip.current = false;
    },
    onUpdate: ({ editor: instance }) => {
      if (skip.current) return;
      onChangeRef.current(serializePmJSONToMarkdown(instance.getJSON()));
    },
    onSelectionUpdate: () => bump((n) => n + 1),
    onTransaction: () => bump((n) => n + 1),
  });

  useEffect(() => {
    if (!editor) return;
    const current = serializePmJSONToMarkdown(editor.getJSON());
    if (current === value) return;
    skip.current = true;
    editor.commands.setContent(asPm(value));
    skip.current = false;
  }, [editor, value]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-canvas">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <span className="mr-auto px-1.5 text-[length:var(--text-caption)] text-muted">
          {t.todos.notes}
        </span>
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
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${
        active ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
