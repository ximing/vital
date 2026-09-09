import type { ApiToken, ApiTokenAccessLog, CreatedApiToken } from '@vital/dto';
import { useEffect, useState, type FormEvent } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

const copy = t.settings.tokens;

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function TokensSection() {
  const [name, setName] = useState('');
  const [items, setItems] = useState<ApiToken[]>([]);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [accessId, setAccessId] = useState<string | null>(null);
  const [accessLogs, setAccessLogs] = useState<ApiTokenAccessLog[] | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);

  useEffect(() => {
    void client
      .listApiTokens()
      .then((res) => setItems(res.items))
      .catch((err: unknown) => setError(humanError(err)));
  }, []);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const next = name.trim();
    if (next === '') return;
    setSaving(true);
    setError(null);
    setCopied(false);
    try {
      const token = await client.createApiToken({ name: next });
      setCreated(token);
      setName('');
      setItems((await client.listApiTokens()).items);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onCopy(): Promise<void> {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch (err) {
      setError(humanError(err));
    }
  }

  async function onRevoke(id: string): Promise<void> {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await client.revokeApiToken(id);
      setConfirmId(null);
      if (created?.id === id) setCreated(null);
      if (accessId === id) {
        setAccessId(null);
        setAccessLogs(null);
      }
      setItems((await client.listApiTokens()).items);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleAccess(id: string): Promise<void> {
    if (accessId === id) {
      setAccessId(null);
      setAccessLogs(null);
      return;
    }
    setAccessId(id);
    setAccessLogs(null);
    setAccessLoading(true);
    setError(null);
    try {
      const res = await client.listApiTokenAccess(id, { limit: 50 });
      setAccessLogs(res.items);
    } catch (err) {
      setError(humanError(err));
      setAccessId(null);
    } finally {
      setAccessLoading(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <form onSubmit={(e) => void onCreate(e)} className="flex flex-col gap-4">
        <Field
          label={copy.name}
          name="apiTokenName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={copy.namePlaceholder}
          maxLength={50}
          autoComplete="off"
        />
        {error ? <Banner>{error}</Banner> : null}
        <div>
          <Button type="submit" loading={saving} disabled={name.trim() === ''}>
            {copy.create}
          </Button>
        </div>
      </form>

      {created ? (
        <div className="rounded-xl bg-surface-muted px-4 py-3">
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {copy.created}
          </p>
          <p className="mt-2 break-all font-mono text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg">
            {created.token}
          </p>
          <div className="mt-3">
            <Button type="button" variant="ghost" onClick={() => void onCopy()}>
              {copied ? copy.copied : copy.copy}
            </Button>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {copy.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const open = accessId === item.id;
            return (
              <li key={item.id} className="rounded-xl bg-surface-muted px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[length:var(--text-body)] font-medium leading-[var(--text-body-lh)] text-fg">
                      {item.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                      {copy.prefix} {item.tokenPrefix}…
                    </p>
                    <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                      {copy.createdAt} {formatTime(item.createdAt)}
                      {' · '}
                      {copy.lastUsed}{' '}
                      {item.lastUsedAt ? formatTime(item.lastUsedAt) : copy.neverUsed}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => void onToggleAccess(item.id)}
                      disabled={accessLoading && accessId === item.id}
                    >
                      {open ? copy.hideAccess : copy.access}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={saving}
                      onClick={() => void onRevoke(item.id)}
                    >
                      {confirmId === item.id ? copy.confirmRevoke : copy.revoke}
                    </Button>
                  </div>
                </div>
                {open ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                      {copy.accessHint}
                    </p>
                    {accessLoading || accessLogs === null ? (
                      <p className="mt-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                        …
                      </p>
                    ) : accessLogs.length === 0 ? (
                      <p className="mt-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                        {copy.accessEmpty}
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {accessLogs.map((log) => (
                          <li
                            key={log.id}
                            className="font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted"
                          >
                            {formatTime(log.createdAt)} {log.method} {log.path} {log.status}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
