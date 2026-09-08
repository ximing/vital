import type { NodeView, NodeViewRendererProps } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown, type PmNode } from '@vital/markdown';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Strikethrough,
  Table as TableIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import { markOnboarding } from '@/features/onboarding/mark';
import { VitalEntity } from './entity-extension';
import { isImageMime, uploadReportFile } from './media';
import { withStubEmbed, type SlashHit } from './model';
import { insertChip, slashFromEditor } from './slash';
import { SlashMenu } from './SlashMenu';
import { reportUi, useReportUi } from './report-ui.service';
import { fetchUploadUrl, uploadIdOf, useUploadUrls } from './upload-url';

function asPm(md: string): PmNode {
  return parseMarkdownToPmJSON(md);
}

/**
 * Live id → signed-url map shared with the pure-DOM image node views:
 * node views read `urls` on (re)build and re-sync whenever the map is replaced.
 */
const imageNodeUrlState: {
  urls: Record<string, string>;
  listeners: Set<() => void>;
} = { urls: {}, listeners: new Set() };

const UploadedImage = Image.extend({
  addNodeView() {
    return ({ node }: NodeViewRendererProps): NodeView => {
      let current = node;
      const img = document.createElement('img');
      const sync = (): void => {
        const src = typeof current.attrs.src === 'string' ? current.attrs.src : '';
        const id = uploadIdOf(src);
        img.src = (id !== null ? imageNodeUrlState.urls[id] : undefined) ?? src;
        if (typeof current.attrs.alt === 'string' && current.attrs.alt !== '') {
          img.alt = current.attrs.alt;
        } else {
          img.removeAttribute('alt');
        }
        if (typeof current.attrs.title === 'string' && current.attrs.title !== '') {
          img.title = current.attrs.title;
        } else {
          img.removeAttribute('title');
        }
      };
      const onUrls = sync;
      sync();
      imageNodeUrlState.listeners.add(onUrls);
      return {
        dom: img,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          sync();
          return true;
        },
        destroy: () => {
          imageNodeUrlState.listeners.delete(onUrls);
        },
      };
    };
  },
}).configure({
  inline: true,
  allowBase64: false,
});

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';
const FILE_ACCEPT = `${IMAGE_ACCEPT},application/pdf,text/plain,text/markdown,.pdf,.txt,.md`;

export function WysiwygEditor({
  reportId,
  bodyMd,
  editable,
  onChange,
  onHydrate,
  onToggleTask,
}: {
  reportId: string;
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
  const editorRef = useRef<Editor | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [liveMd, setLiveMd] = useState(bodyMd);
  const [, bump] = useState(0);
  const ingestRef = useRef<(files: FileList | File[]) => Promise<void>>(async () => undefined);
  const uploadUrls = useUploadUrls(liveMd);

  useEffect(() => {
    imageNodeUrlState.urls = uploadUrls;
    for (const sync of imageNodeUrlState.listeners) sync();
  }, [uploadUrls]);

  useEffect(() => {
    onChangeRef.current = onChange;
    onHydrateRef.current = onHydrate;
  });

  async function ingestFiles(files: FileList | File[]): Promise<void> {
    const instance = editorRef.current;
    if (!instance || !editable) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of list) {
        const uploaded = await uploadReportFile(file, reportId);
        if (isImageMime(uploaded.mime)) {
          const id = uploadIdOf(uploaded.src);
          if (id !== null) {
            // Warm the cache so the freshly inserted image renders signed immediately.
            await fetchUploadUrl(id).catch(() => undefined);
          }
          instance.chain().focus().setImage({ src: uploaded.src, alt: uploaded.name }).run();
        } else {
          instance
            .chain()
            .focus()
            .insertContent({
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: uploaded.name,
                  marks: [{ type: 'link', attrs: { href: uploaded.src } }],
                },
              ],
            })
            .run();
        }
      }
    } catch {
      setUploadError(t.reports.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

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
      UploadedImage,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
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
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (files && files.length > 0) {
          event.preventDefault();
          void ingestRef.current(files);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          event.preventDefault();
          void ingestRef.current(files);
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
      setLiveMd(md);
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
    ingestRef.current = ingestFiles;
    editorRef.current = editor;
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
    const anchor = target.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href');
      const id = href !== null ? uploadIdOf(href) : null;
      if (id !== null) {
        // Upload refs persist as /api/v1/uploads/<id>; open the signed url instead.
        // preventDefault: in read-only mode the browser would otherwise follow the
        // raw href, and the 302 route no longer exists (current tab would 404).
        event.preventDefault();
        const resolved = uploadUrls[id];
        if (resolved !== undefined) {
          window.open(resolved, '_blank', 'noopener');
        } else {
          void fetchUploadUrl(id)
            .then((url) => window.open(url, '_blank', 'noopener'))
            .catch(() => undefined);
        }
        return;
      }
    }
    const toggle = target.closest('[data-chip-toggle]');
    if (!toggle) return;
    const chip = toggle.closest('[data-kind="task"][data-id]');
    const id = chip?.getAttribute('data-id');
    if (id) onToggleTask(id);
  }

  function setLink(): void {
    if (!editor) return;
    const previous = editor.getAttributes('link').href;
    const href = window.prompt(t.reports.linkPrompt, typeof previous === 'string' ? previous : 'https://');
    if (href === null) return;
    const trimmed = href.trim();
    if (trimmed === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
  }

  function onPickImage(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files;
    event.target.value = '';
    if (files) void ingestFiles(files);
  }

  const canEdit = editable && !uploading;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="report-wysiwyg"
      data-region="report-editor"
      onClick={onClick}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 py-1">
        <span className="mr-2 px-1 text-[length:var(--text-caption)] text-muted">
          {t.reports.writeToday}
        </span>
        <ToolbarBtn
          label={t.reports.bold}
          active={editor?.isActive('bold') === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Icon icon={Bold} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.italic}
          active={editor?.isActive('italic') === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Icon icon={Italic} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.strike}
          active={editor?.isActive('strike') === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Icon icon={Strikethrough} size={14} />
        </ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn
          label={t.reports.heading}
          active={editor?.isActive('heading', { level: 1 }) === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Icon icon={Heading1} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.heading2}
          active={editor?.isActive('heading', { level: 2 }) === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Icon icon={Heading2} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.quote}
          active={editor?.isActive('blockquote') === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Icon icon={Quote} size={14} />
        </ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn
          label={t.reports.bullet}
          active={editor?.isActive('bulletList') === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <Icon icon={List} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.ordered}
          active={editor?.isActive('orderedList') === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <Icon icon={ListOrdered} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.code}
          active={editor?.isActive('codeBlock') === true}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          <Icon icon={Code} size={14} />
        </ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn label={t.reports.link} active={editor?.isActive('link') === true} disabled={!canEdit} onClick={setLink}>
          <Icon icon={Link2} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.image}
          active={false}
          disabled={!canEdit}
          onClick={() => imageInputRef.current?.click()}
        >
          <Icon icon={ImageIcon} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.attach}
          active={false}
          disabled={!canEdit}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon icon={Paperclip} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.table}
          active={editor?.isActive('table') === true}
          disabled={!canEdit}
          onClick={() => {
            if (!editor) return;
            if (editor.isActive('table')) {
              editor.chain().focus().deleteTable().run();
              return;
            }
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          }}
        >
          <Icon icon={TableIcon} size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          label={t.reports.rule}
          active={false}
          disabled={!canEdit}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          <Icon icon={Minus} size={14} />
        </ToolbarBtn>
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={onPickImage}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={onPickImage}
        />
      </div>
      {uploadError ? (
        <p className="mt-2 rounded-md bg-danger/10 px-3 py-1.5 text-[length:var(--text-caption)] text-danger" role="alert">
          {uploadError}
        </p>
      ) : null}
      <div className="min-h-[16rem] min-w-0 flex-1 overflow-y-auto py-4">
        <EditorContent editor={editor} />
      </div>
      {slash && editor ? (
        <SlashMenu slash={slash} onPick={pick} onClose={() => setSlash(null)} />
      ) : null}
    </div>
  );
}

function ToolbarSep() {
  return <span className="w-1 shrink-0" aria-hidden />;
}

function ToolbarBtn({
  children,
  active,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${
        disabled
          ? 'text-muted/40'
          : active
            ? 'bg-accent-subtle text-fg'
            : 'text-muted hover:bg-surface-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
