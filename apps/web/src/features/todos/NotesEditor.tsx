import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown, type PmNode } from '@vital/markdown';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/copy';

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
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg');
  const onChangeRef = useRef(onChange);
  const skip = useRef(true);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
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
  });

  useEffect(() => {
    if (!editor || mode !== 'wysiwyg') return;
    const current = serializePmJSONToMarkdown(editor.getJSON());
    if (current === value) return;
    skip.current = true;
    editor.commands.setContent(asPm(value));
    skip.current = false;
  }, [editor, mode, value]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-canvas">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="px-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.todos.notes}
        </span>
        <div className="flex gap-0.5" role="tablist" aria-label={t.todos.notes}>
          {(
            [
              ['wysiwyg', t.todos.notesWysiwyg],
              ['source', t.todos.notesSource],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={`rounded px-2 py-1 text-[length:var(--text-caption)] ${
                mode === id ? 'bg-accent-subtle text-fg' : 'text-muted hover:text-fg'
              }`}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'source' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          spellCheck
          aria-label={t.todos.notes}
          className="task-notes-source min-h-40 w-full resize-y bg-transparent px-3 py-2 text-[length:var(--text-meta)] leading-[var(--text-body-lh)] text-fg outline-none"
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
