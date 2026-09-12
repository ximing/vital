import { IMAGE_MIME_TYPES } from '@vital/dto';
import { bindServices, useService } from '@rabjs/react';
import { ImagePlus, LogOut } from 'lucide-react';
import { useRef, type ChangeEvent, type FC, type FormEvent } from 'react';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { AccountSectionService } from './account.service';

function AccountSectionContent() {
  const page = useService(AccountSectionService);
  page.prime();
  const user = page.auth.user;
  const saving = page.$model.saveProfile.loading || page.$model.saveAvatar.loading;
  const avatarInput = useRef<HTMLInputElement>(null);
  const initial = (user?.displayName ?? '?').slice(0, 1);

  function onAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user || !(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return;
    void page.saveAvatar(file);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void page.saveProfile();
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-5">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-accent-subtle">
          {user?.avatarUrl && !page.avatarFailed ? (
            <img
              src={user.avatarUrl}
              alt={t.settings.avatarAlt}
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => page.setAvatarFailed(true)}
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
            <Button variant="quiet" className="gap-2" onClick={() => void page.auth.logout()}>
              <Icon icon={LogOut} size={15} />
              {t.nav.logout}
            </Button>
            <input
              ref={avatarInput}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
              onChange={(event) => onAvatarChange(event)}
            />
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
        <Field
          label={t.settings.displayName}
          name="displayName"
          value={page.displayName}
          onChange={(e) => page.setDisplayName(e.target.value)}
          maxLength={50}
        />
        {page.error ? <Banner>{page.error}</Banner> : null}
        <div>
          <Button type="submit" loading={saving} disabled={page.displayName.trim() === ''}>
            {t.settings.saveProfile}
          </Button>
        </div>
      </form>
    </div>
  );
}

export const AccountSection: FC = bindServices(AccountSectionContent, [AccountSectionService]);
