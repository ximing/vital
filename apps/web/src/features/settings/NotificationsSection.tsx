import { DEFAULT_NOTIFICATION_PREFS, type NotificationChannel, type NotificationPrefs } from '@vital/dto';
import { useEffect, useState } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { TimeField } from '@/ui/time-field';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

function prefsOf(value: NotificationPrefs | undefined): NotificationPrefs {
  return value ?? DEFAULT_NOTIFICATION_PREFS;
}

export function NotificationsSection({ heading = true }: { heading?: boolean }) {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const copy = t.settings.notify;
  const prefs = prefsOf(user?.notifications);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [nickname, setNickname] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void client
      .listNotificationChannels()
      .then((res) => {
        setChannels(res.items);
        const meow = res.items.find((c) => c.type === 'meow');
        if (meow) {
          setNickname(meow.config.nickname);
          setEnabled(meow.enabled);
        }
      })
      .catch((err: unknown) => setError(humanError(err)));
  }, []);

  const meow = channels.find((c) => c.type === 'meow');

  async function savePrefs(next: NotificationPrefs): Promise<void> {
    const updated = await client.updateMe({ notifications: next });
    setUser(updated);
  }

  async function saveChannel(): Promise<void> {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      if (meow) {
        const updated = await client.patchNotificationChannel(meow.id, {
          enabled,
          config: { nickname },
        });
        setChannels((list) => list.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        const created = await client.createNotificationChannel({
          type: 'meow',
          enabled,
          config: { nickname },
        });
        setChannels((list) => [...list, created]);
      }
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(): Promise<void> {
    if (!meow) return;
    setError(null);
    setNotice(null);
    setTesting(true);
    try {
      await client.testNotificationChannel(meow.id);
      setNotice(copy.testOk);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className={heading ? 'mt-8' : undefined}>
      {heading ? (
        <>
          <h2 className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {copy.title}
          </h2>
          <p className="mt-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {copy.hint}
          </p>
        </>
      ) : null}

      <label className="flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.taskRemind}
          onChange={(e) => void savePrefs({ ...prefs, taskRemind: e.target.checked })}
        />
        {copy.taskRemind}
      </label>
      <label className="flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.taskDue}
          onChange={(e) => void savePrefs({ ...prefs, taskDue: e.target.checked })}
        />
        {copy.taskDue}
      </label>

      <TimeField
        className="mt-4 max-w-xs"
        label={copy.allDayTime}
        value={prefs.allDayNotifyTime}
        onChange={(value) => {
          if (value === '') return;
          void savePrefs({ ...prefs, allDayNotifyTime: value });
        }}
      />

      <div className="mt-4 grid max-w-lg grid-cols-2 gap-3">
        <TimeField
          label={copy.quietStart}
          value={prefs.quietHoursStart ?? ''}
          clearable
          onChange={(start) => {
            const nextStart = start === '' ? null : start;
            const end = nextStart === null ? null : (prefs.quietHoursEnd ?? '08:00');
            void savePrefs({ ...prefs, quietHoursStart: nextStart, quietHoursEnd: end });
          }}
        />
        <TimeField
          label={copy.quietEnd}
          value={prefs.quietHoursEnd ?? ''}
          disabled={prefs.quietHoursStart === null}
          clearable
          onChange={(end) => {
            const nextEnd = end === '' ? null : end;
            const start = nextEnd === null ? null : prefs.quietHoursStart;
            void savePrefs({ ...prefs, quietHoursStart: start, quietHoursEnd: nextEnd });
          }}
        />
      </div>

      <h3 className="mt-8 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {copy.channels}
      </h3>
      <Field
        className="mt-3"
        label={copy.nickname}
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        autoComplete="off"
      />
      <label className="mt-2 flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {copy.enabled}
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => void saveChannel()} loading={saving} disabled={nickname.trim() === ''}>
          {copy.saveChannel}
        </Button>
        <Button variant="ghost" onClick={() => void sendTest()} loading={testing} disabled={!meow}>
          {testing ? copy.testing : copy.test}
        </Button>
      </div>
      {meow?.lastError ? (
        <p className="mt-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-danger">
          {copy.lastError}：{meow.lastError}
        </p>
      ) : null}
      {error ? <Banner>{error}</Banner> : null}
      {notice ? (
        <p className="mt-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
