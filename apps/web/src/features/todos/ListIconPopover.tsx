import { IMAGE_MIME_TYPES, type List } from '@vital/dto';
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type HTMLAttributes,
} from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { clampAnchorMenu, type MenuAnchor } from '@/ui/anchor-menu';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { useTodoActions } from './queries';

const EmojiGrid = lazy(async () => {
  const { EmojiPicker } = await import('frimousse');
  return {
    default: function Grid({ onPick }: { onPick: (emoji: string) => void }) {
      return (
        <EmojiPicker.Root
          className="flex h-72 w-72 flex-col"
          locale="zh"
          emojibaseUrl="/emojibase"
          onEmojiSelect={(emoji) => onPick(emoji.emoji)}
        >
          <EmojiPicker.Search
            placeholder={t.nav.search}
            className="mx-1 mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[length:var(--text-meta)] text-fg placeholder:text-muted"
          />
          <EmojiPicker.Viewport className="relative min-h-0 flex-1 overflow-auto">
            <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-[length:var(--text-caption)] text-muted">
              {t.todos.loading}
            </EmojiPicker.Loading>
            <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-[length:var(--text-caption)] text-muted">
              {t.palette.empty}
            </EmojiPicker.Empty>
            <EmojiPicker.List
              className="pb-1"
              components={{
                CategoryHeader: ({ category, ...props }) => (
                  <div
                    className="sticky top-0 bg-elevated px-2 py-1 text-[11px] font-medium text-muted"
                    {...(props as HTMLAttributes<HTMLDivElement>)}
                  >
                    {category.label}
                  </div>
                ),
                Row: ({ children, ...props }) => (
                  <div className="flex px-1" {...(props as HTMLAttributes<HTMLDivElement>)}>
                    {children}
                  </div>
                ),
                Emoji: ({ emoji, ...props }) => (
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-surface-muted data-[active]:bg-surface-muted"
                    {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
                  >
                    {emoji.emoji}
                  </button>
                ),
              }}
            />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
      );
    },
  };
});

export function ListIconPopover({
  list,
  anchor,
  onClose,
  onPicked,
}: {
  list: List;
  anchor: MenuAnchor;
  onClose: () => void;
  onPicked: () => void;
}) {
  const { patchList } = useTodoActions();
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => ({ left: anchor.right + 8, top: anchor.top }));

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(clampAnchorMenu(anchor, rect.width, rect.height));
  }, [anchor, tab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  async function pickEmoji(emoji: string) {
    await patchList.mutateAsync({ id: list.id, input: { icon: emoji, iconAttachmentId: null } });
    onPicked();
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return;
    const uploaded = await client.upload({ file, mime: file.type, size: file.size });
    await client.bindUpload(uploaded.id, { ownerType: 'list', ownerId: list.id });
    await patchList.mutateAsync({
      id: list.id,
      input: { iconAttachmentId: uploaded.id, icon: null },
    });
    onPicked();
  }

  async function clearIcon() {
    await patchList.mutateAsync({ id: list.id, input: { icon: null, iconAttachmentId: null } });
    onPicked();
  }

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t.todos.setListIcon}
        style={{ left: pos.left, top: pos.top }}
        className={`fixed w-80 ${FIELD_POPOVER_CLASS} p-2`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex gap-1">
          <button
            type="button"
            className={`h-7 rounded-md px-2 text-[length:var(--text-caption)] ${
              tab === 'emoji' ? 'bg-accent-subtle text-fg' : 'text-muted hover:text-fg'
            }`}
            onClick={() => setTab('emoji')}
          >
            {t.todos.listIconEmoji}
          </button>
          <button
            type="button"
            className={`h-7 rounded-md px-2 text-[length:var(--text-caption)] ${
              tab === 'upload' ? 'bg-accent-subtle text-fg' : 'text-muted hover:text-fg'
            }`}
            onClick={() => setTab('upload')}
          >
            {t.todos.listIconUpload}
          </button>
          <button
            type="button"
            className="ml-auto h-7 rounded-md px-2 text-[length:var(--text-caption)] text-muted hover:text-fg"
            onClick={() => void clearIcon()}
          >
            {t.todos.listIconClear}
          </button>
        </div>
        {tab === 'emoji' ? (
          <Suspense
            fallback={
              <p className="py-8 text-center text-[length:var(--text-caption)] text-muted">
                {t.todos.loading}
              </p>
            }
          >
            <EmojiGrid onPick={(emoji) => void pickEmoji(emoji)} />
          </Suspense>
        ) : (
          <div className="px-2 py-6 text-center">
            <button
              type="button"
              className="rounded-md bg-surface-muted px-3 py-1.5 text-[length:var(--text-meta)] text-fg hover:bg-accent-subtle"
              onClick={() => fileRef.current?.click()}
            >
              {t.todos.listIconUpload}
            </button>
            <input
              ref={fileRef}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
              onChange={(event) => void onFile(event)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
