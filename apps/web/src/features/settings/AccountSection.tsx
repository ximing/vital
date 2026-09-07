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
    <div>
      <div className="mb-8 flex items-center gap-4">
        {user?.avatarUrl && !avatarFailed ? (
          <img
            src={user.avatarUrl}
            alt="头像"
            className="h-16 w-16 rounded-full object-cover"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-subtle text-lg font-semibold text-accent-deep">
            {(user?.displayName ?? '?').slice(0, 1)}
          </div>
        )}
        <div>
          <Button variant="ghost" className="gap-2" onClick={() => avatarInput.current?.click()} loading={saving}>
            <Icon icon={ImagePlus} size={15} />
            设置头像
          </Button>
          <input ref={avatarInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" onChange={(event) => void onAvatarChange(event)} />
        </div>
      </div>
      <form onSubmit={(e) => void onSubmit(e)} className="flex max-w-xl flex-col gap-4">
        <Field
          label={t.settings.displayName}
          name="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
        />
        {user ? (
          <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {user.email}
          </p>
        ) : null}
        {error ? <Banner>{error}</Banner> : null}
        <Button type="submit" loading={saving} disabled={displayName.trim() === ''}>
          {t.settings.saveProfile}
        </Button>
      </form>
      <Button variant="danger" className="mt-10 gap-2" onClick={() => void logout()}>
        <Icon icon={LogOut} size={15} />
        {t.nav.logout}
      </Button>
    </div>
  );
}
