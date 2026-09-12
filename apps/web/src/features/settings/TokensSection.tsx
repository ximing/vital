import { bindServices, useService } from '@rabjs/react';
import { useEffect, type FC, type FormEvent } from 'react';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { TokensSectionService } from './tokens.service';

const copy = t.settings.tokens;

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function TokensSectionContent() {
  const page = useService(TokensSectionService);
  const saving = page.$model.create.loading || page.$model.revoke.loading;
  const accessLoading = page.$model.toggleAccess.loading;

  useEffect(() => {
    void page.load();
  }, [page]);

  function onCreate(event: FormEvent): void {
    event.preventDefault();
    void page.create();
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <form onSubmit={onCreate} className="flex flex-col gap-4">
        <Field
          label={copy.name}
          name="apiTokenName"
          value={page.name}
          onChange={(e) => page.setName(e.target.value)}
          placeholder={copy.namePlaceholder}
          maxLength={50}
          autoComplete="off"
        />
        {page.error ? <Banner>{page.error}</Banner> : null}
        <div>
          <Button type="submit" loading={saving} disabled={page.name.trim() === ''}>
            {copy.create}
          </Button>
        </div>
      </form>

      {page.created ? (
        <div className="rounded-xl bg-surface-muted px-4 py-3">
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {copy.created}
          </p>
          <p className="mt-2 break-all font-mono text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg">
            {page.created.token}
          </p>
          <div className="mt-3">
            <Button type="button" variant="ghost" onClick={() => void page.copy()}>
              {page.copied ? copy.copied : copy.copy}
            </Button>
          </div>
        </div>
      ) : null}

      {page.items.length === 0 ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {copy.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {page.items.map((item) => {
            const open = page.accessId === item.id;
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
                      onClick={() => void page.toggleAccess(item.id)}
                      disabled={accessLoading && page.accessId === item.id}
                    >
                      {open ? copy.hideAccess : copy.access}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={saving}
                      onClick={() => void page.revoke(item.id)}
                    >
                      {page.confirmId === item.id ? copy.confirmRevoke : copy.revoke}
                    </Button>
                  </div>
                </div>
                {open ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                      {copy.accessHint}
                    </p>
                    {accessLoading || page.accessLogs === null ? (
                      <p className="mt-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                        …
                      </p>
                    ) : page.accessLogs.length === 0 ? (
                      <p className="mt-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                        {copy.accessEmpty}
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {page.accessLogs.map((log) => (
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

export const TokensSection: FC = bindServices(TokensSectionContent, [TokensSectionService]);
