import { observer, useService } from '@rabjs/react';
import { Link2, LoaderCircle, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FC, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { hostLabel, normalizePasteUrl, PASTE_URL_ID } from './model';
import { useInboxActions } from './queries';
import { InboxUiService } from './inbox-ui.service';

export const PasteUrl: FC<{ disabled?: boolean }> = observer(function PasteUrl({ disabled }) {
  const inbox = useService(InboxUiService);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const actions = useInboxActions();
  const nonce = inbox.pasteNonce;
  const preview = inbox.preview;
  const previewTitle = inbox.previewTitle;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (nonce > 0) inputRef.current?.focus();
  }, [nonce]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled || busy) return;
    const raw = (preview?.originalUrl ?? value).trim();
    if (raw === '') return;
    setError(null);
    setBusy(true);
    try {
      const url = normalizePasteUrl(raw);
      if (url === null) {
        const item = await actions.createManual(raw);
        setValue('');
        navigate(`/inbox/${item.id}`);
        return;
      }
      setValue(url);
      await actions.extract(url);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (disabled || busy || preview === null) return;
    setError(null);
    setBusy(true);
    try {
      const item = await actions.createFromPreview();
      setValue('');
      navigate(`/inbox/${item.id}`);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  const displayed = preview?.originalUrl ?? value;
  const extracting = busy && preview === null;
  const site = preview ? (preview.siteName ?? hostLabel(preview.originalUrl)) : null;

  return (
    <div className="min-w-0">
      <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-2">
        <div className="relative">
          <Icon
            icon={Link2}
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary"
          />
          <input
            id={PASTE_URL_ID}
            ref={inputRef}
            type="text"
            name="url"
            inputMode="url"
            autoComplete="url"
            maxLength={2048}
            disabled={disabled || busy}
            value={displayed}
            onChange={(e) => {
              setValue(e.target.value);
              if (preview) inbox.setPreview(null);
            }}
            placeholder={t.inbox.pastePlaceholder}
            aria-label={t.inbox.pastePlaceholder}
            className={`${FIELD_CONTROL_CLASS} w-full min-w-0 pl-8 pr-9 text-[length:var(--text-meta)]`}
          />
          <button
            type="submit"
            aria-label={extracting ? t.inbox.extracting : t.inbox.extract}
            title={t.inbox.extract}
            disabled={disabled || busy || displayed.trim() === ''}
            className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-tertiary transition-[background-color,color] duration-[var(--ease-out)] hover:bg-accent-subtle hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon
              icon={extracting ? LoaderCircle : Sparkles}
              size={14}
              className={extracting ? 'animate-spin' : undefined}
            />
          </button>
        </div>
      </form>
      {error ? (
        <div className="mt-2">
          <Banner>{error}</Banner>
        </div>
      ) : null}
      {preview ? (
        <div className="mt-3 min-w-0 rounded-lg border border-border bg-surface px-3.5 py-3.5 shadow-[var(--shadow-xs)]">
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.inbox.preview}
          </p>
          <label className="mt-2 block">
            <span className="sr-only">{t.todos.title}</span>
            <input
              value={previewTitle}
              maxLength={500}
              onChange={(e) => inbox.setPreviewTitle(e.target.value)}
              className={`${FIELD_CONTROL_CLASS} w-full font-semibold`}
            />
          </label>
          <p className="mt-2 break-all text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {site ? `${site} · ` : null}
            {preview.originalUrl ?? t.inbox.noOriginalUrl}
          </p>
          {preview.excerpt ? (
            <p className="mt-2 line-clamp-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
              {preview.excerpt}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void onSave()} loading={busy} disabled={disabled}>
              {busy ? t.inbox.saving : t.inbox.save}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                inbox.setPreview(null);
                setError(null);
              }}
            >
              {t.inbox.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
