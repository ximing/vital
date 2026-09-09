import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown, type PmNode } from '@vital/markdown';
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
} from 'lucide-react';
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
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
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
    <div className="group/notes min-h-[6rem]">
      <div className="mb-1 flex flex-wrap items-center gap-0.5 opacity-0 transition-opacity group-focus-within/notes:opacity-100 group-hover/notes:opacity-100">
        <ToolbarBtn
          label="小标题"
          active={editor?.isActive('heading', { level: 2 }) === true}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Icon icon={Heading2} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="子标题"
          active={editor?.isActive('heading', { level: 3 }) === true}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Icon icon={Heading3} size={14} />
        </ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn
          label="粗体"
          active={editor?.isActive('bold') === true}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Icon icon={Bold} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="斜体"
          active={editor?.isActive('italic') === true}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Icon icon={Italic} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="删除线"
          active={editor?.isActive('strike') === true}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Icon icon={Strikethrough} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="行内代码"
          active={editor?.isActive('code') === true}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Icon icon={Code} size={14} />
        </ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn
          label="列表"
          active={editor?.isActive('bulletList') === true}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <Icon icon={List} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="编号列表"
          active={editor?.isActive('orderedList') === true}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <Icon icon={ListOrdered} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="引用"
          active={editor?.isActive('blockquote') === true}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Icon icon={Quote} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label="代码块"
          active={editor?.isActive('codeBlock') === true}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          <Icon icon={SquareCode} size={14} />
        </ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn
          label="链接"
          active={editor?.isActive('link') === true}
          onClick={() => setLink(editor)}
        >
          <Icon icon={LinkIcon} size={14} />
        </ToolbarBtn>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function setLink(editor: Editor | null): void {
  if (!editor) return;
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  const previous = editor.getAttributes('link').href;
  const href = window.prompt('链接地址', typeof previous === 'string' ? previous : 'https://');
  if (href === null) return;
  const trimmed = href.trim();
  if (trimmed === '') {
    editor.chain().focus().unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
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

function ToolbarSep() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border/80" />;
}
