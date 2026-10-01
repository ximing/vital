import { IMAGE_MIME_TYPES, type List } from '@vital/dto';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { clampAnchorMenu, type MenuAnchor } from '@/ui/anchor-menu';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Overlay } from '@/ui/overlay';
import { useTodoActions } from './queries';

/** Enough for a list glyph. The full emoji catalog stays off this screen. */
const LIST_ICONS = [
  '📥',
  '⭐',
  '❤️',
  '🏠',
  '💼',
  '📚',
  '🎯',
  '✅',
  '🌱',
  '🔥',
  '💡',
  '🎁',
  '🛒',
  '🏃',
  '☕',
  '🌙',
  '🎵',
  '✈️',
  '💰',
  '🧪',
  '📌',
  '🗓️',
  '👶',
  '🐾',
  '🌿',
  '🍎',
  '💻',
  '📝',
  '🎨',
  '🏀',
  '🌸',
  '🏔️',
  '🚗',
  '📷',
  '🎮',
  '💤',
  '🧠',
  '📦',
  '🔔',
  '🏷️',
  '🧩',
  '🌈',
  '☀️',
  '🌊',
  '🍀',
  '📎',
  '🔑',
] as const;

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
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
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
    <Overlay onClose={onClose} closeOnBackdrop closeOnEscape>
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
          <div className="grid grid-cols-8 gap-0.5 px-1 pb-1">
            {LIST_ICONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-surface-muted"
                onClick={() => void pickEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
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
    </Overlay>
  );
}
