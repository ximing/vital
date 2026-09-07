import { ImagePlus, LogOut } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { IMAGE_MIME_TYPES } from '@vital/dto';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Icon } from '@/ui/icon';

export function AccountSection() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const logout = useAuth((s) => s.logout);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const initial = (user?.displayName ?? '?').slice(0, 1);

  async function onAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user || !(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return;
    setSaving(true);
    setError(null);
    try {
      const uploaded = await client.upload({ file, mime: file.type, size: file.size });
      await client.bindUpload(uploaded.id, { ownerType: 'user', ownerId: user.id });
      setAvatarFailed(false);
      setUser(await client.updateMe({ avatarAttachmentId: uploaded.id }));
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = displayName.trim();
    if (next === '' || next === user?.displayName) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await client.updateMe({ displayName: next });
      setUser(updated);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-5">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-accent-subtle">
          {user?.avatarUrl && !avatarFailed ? (
            <img
              src={user.avatarUrl}
              alt={t.settings.avatarAlt}
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-accent-deep">
              {initial}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
            {user?.displayName || t.settings.account}
          </p>
          {user ? (
            <p className="mt-0.5 truncate text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
              {user.email}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" className="gap-2" onClick={() => avatarInput.current?.click()} loading={saving}>
              <Icon icon={ImagePlus} size={15} />
              {t.settings.changeAvatar}
            </Button>
            <Button variant="quiet" className="gap-2" onClick={() => void logout()}>
              <Icon icon={LogOut} size={15} />
              {t.nav.logout}
            </Button>
            <input
              ref={avatarInput}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
              onChange={(event) => void onAvatarChange(event)}
            />
          </div>
        </div>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="flex max-w-2xl flex-col gap-4">
        <Field
          label={t.settings.displayName}
          name="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
        />
        {error ? <Banner>{error}</Banner> : null}
        <div>
          <Button type="submit" loading={saving} disabled={displayName.trim() === ''}>
            {t.settings.saveProfile}
          </Button>
        </div>
      </form>
    </div>
  );
}
