import { llmReady, parseLlmParameters } from '@vital/dto';
import { useState, type FormEvent } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { LlmParametersEditor } from './LlmParametersEditor';

export function LlmSection() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const llm = user?.llm;
  const [apiBase, setApiBase] = useState(llm?.apiBase ?? '');
  const [model, setModel] = useState(llm?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [parameters, setParameters] = useState(JSON.stringify(llm?.parameters ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  let parametersDirty = true;
  try {
    parametersDirty =
      JSON.stringify(parseLlmParameters(parameters)) !== JSON.stringify(llm?.parameters ?? {});
  } catch {
    /* Invalid edits must be saved or corrected before testing. */
  }
  const dirty =
    parametersDirty ||
    apiBase.trim() !== (llm?.apiBase ?? '') ||
    model.trim() !== (llm?.model ?? '') ||
    apiKey.trim() !== '';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextBase = apiBase.trim();
    const nextModel = model.trim();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await client.updateMe({
        llm: {
          apiBase: nextBase === '' ? null : nextBase,
          model: nextModel === '' ? null : nextModel,
          parameters: parseLlmParameters(parameters),
          ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
        },
      });
      setUser(updated);
      setApiKey('');
      setParameters(JSON.stringify(updated.llm.parameters ?? {}, null, 2));
      setNotice(t.settings.llm.saved);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await client.testLlm();
      setNotice(t.settings.llm.testOk);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setTesting(false);
    }
  }

  async function onClearKey() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await client.updateMe({ llm: { apiKey: null } });
      setUser(updated);
      setApiKey('');
      setNotice(t.settings.llm.saved);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex max-w-2xl flex-col gap-4">
      <Field
        label={t.settings.llm.apiBase}
        name="llmApiBase"
        value={apiBase}
        onChange={(e) => setApiBase(e.target.value)}
        placeholder={t.settings.llm.apiBaseHint}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="-mt-3 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
        {t.settings.llm.apiBaseHint}
      </p>
      <Field
        label={t.settings.llm.model}
        name="llmModel"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder={t.settings.llm.modelHint}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="-mt-3 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
        {t.settings.llm.modelHint}
      </p>
      <Field
        label={t.settings.llm.apiKey}
        name="llmApiKey"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={t.settings.llm.apiKeyPlaceholder}
        autoComplete="new-password"
        spellCheck={false}
      />
      {llm?.apiKeySet ? (
        <p className="-mt-3 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.settings.llm.apiKeySet}
        </p>
      ) : (
        <p className="-mt-3 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.settings.llm.notConfigured}
        </p>
      )}
      <LlmParametersEditor value={parameters} onChange={setParameters} />
      {dirty ? <p className="text-sm text-muted">{t.settings.llm.saveBeforeTest}</p> : null}
      {error ? <Banner>{error}</Banner> : null}
      {notice ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving} disabled={testing}>
          {t.settings.llm.save}
        </Button>
        <Button
          type="button"
          variant="ghost"
          loading={testing}
          disabled={!llmReady(user?.llm) || dirty || saving}
          onClick={() => void onTest()}
        >
          {t.settings.llm.test}
        </Button>
        {llm?.apiKeySet ? (
          <Button
            type="button"
            variant="quiet"
            disabled={saving || testing}
            onClick={() => void onClearKey()}
          >
            {t.settings.llm.clearKey}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
