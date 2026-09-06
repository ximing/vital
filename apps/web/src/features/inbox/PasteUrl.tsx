import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { hostLabel, normalizePasteUrl, PASTE_URL_ID } from './model';
import { useInboxActions } from './queries';
import { useInboxUi } from './inbox-ui.service';

export function PasteUrl({ disabled }: { disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const actions = useInboxActions();
  const nonce = useInboxUi((s) => s.pasteNonce);
  const preview = useInboxUi((s) => s.preview);
  const previewTitle = useInboxUi((s) => s.previewTitle);
  const setPreview = useInboxUi((s) => s.setPreview);
  const setPreviewTitle = useInboxUi((s) => s.setPreviewTitle);
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
    <div className="px-4 pb-3 pt-1">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
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
            if (preview) setPreview(null);
          }}
          placeholder={t.inbox.pastePlaceholder}
          aria-label={t.inbox.pasteUrl}
          className="h-[var(--field-h)] min-w-[16rem] flex-1 rounded-md border border-border bg-surface px-3 text-fg placeholder:text-muted"
        />
        <Button type="submit" variant="ghost" loading={extracting} disabled={disabled || busy}>
          {extracting ? t.inbox.extracting : t.inbox.extract}
        </Button>
      </form>
      {error ? (
        <div className="mt-2">
          <Banner>{error}</Banner>
        </div>
      ) : null}
      {preview ? (
        <div className="mt-3 rounded-md border border-border bg-surface px-4 py-3">
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.inbox.preview}
          </p>
          <label className="mt-2 block">
            <span className="sr-only">{t.todos.title}</span>
            <input
              value={previewTitle}
              maxLength={500}
              onChange={(e) => setPreviewTitle(e.target.value)}
              className="h-[var(--field-h)] w-full rounded-md border border-border bg-canvas px-3 text-[length:var(--text-body)] font-semibold text-fg"
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
                setPreview(null);
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
}
