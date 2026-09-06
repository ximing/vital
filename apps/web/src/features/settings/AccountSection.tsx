import { useState, type FormEvent } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

export function AccountSection() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const logout = useAuth((s) => s.logout);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      <form onSubmit={(e) => void onSubmit(e)} className="flex max-w-sm flex-col gap-4">
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
      <Button variant="quiet" className="mt-10 px-0" onClick={() => void logout()}>
        {t.nav.logout}
      </Button>
    </div>
  );
}
