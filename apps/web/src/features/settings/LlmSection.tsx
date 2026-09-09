import {
  LLM_CAPABILITIES,
  type LlmCapability,
  type LlmCatalogProvider,
  type LlmProviderPublic,
  type LlmRouting,
  type LlmSettingsPublic,
} from '@vital/dto';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { SelectField } from '@/ui/select-field';
import { ModelSelect } from './ModelSelect';
import { ModelParameters, parseModelParameters } from './ModelParameters';

type CatalogProvider = LlmCatalogProvider;

function routeKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

function AddProviderForm({
  catalog,
  onDone,
  onError,
}: {
  catalog: CatalogProvider[];
  onDone: (next: LlmSettingsPublic) => void;
  onError: (message: string) => void;
}) {
  const [providerId, setProviderId] = useState('openai');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const entry = catalog.find((item) => item.id === providerId);
  const isCustom = providerId === 'custom';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const models = picked;
    setSaving(true);
    try {
      const next = await client.addLlmProvider({
        providerId,
        label:
          label.trim() || (isCustom ? t.settings.llm.customEndpoint : (entry?.name ?? providerId)),
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
        apiKey: apiKey.trim(),
        models,
        ...(Object.keys(parameterDrafts).length
          ? { modelParameters: parseModelParameters(models, parameterDrafts) }
          : {}),
      });
      onDone(next);
    } catch (err) {
      onError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="mt-3 flex flex-col gap-3 rounded-[14px] border border-border bg-elevated p-4"
    >
      <SelectField
        value={providerId}
        ariaLabel={t.settings.llm.addProvider}
        options={[
          ...catalog.map((item) => ({ value: item.id, label: item.name })),
          { value: 'custom', label: t.settings.llm.customEndpoint },
        ]}
        onChange={(next) => {
          setProviderId(next);
          setPicked([]);
          setParameterDrafts({});
        }}
      />
      <Field
        label={t.settings.llm.providerLabel}
        name="providerLabel"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={isCustom ? t.settings.llm.providerLabelPlaceholder : (entry?.name ?? '')}
        autoComplete="off"
        spellCheck={false}
      />
      {isCustom ? (
        <Field
          label={t.settings.llm.apiBase}
          name="providerBaseUrl"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={t.settings.llm.apiBaseHint}
          autoComplete="off"
          spellCheck={false}
        />
      ) : null}
      <ModelSelect
        key={providerId}
        options={entry?.models ?? []}
        value={picked}
        onChange={setPicked}
      />
      {picked.map((modelId) => (
        <ModelParameters
          key={modelId}
          modelId={modelId}
          model={entry?.models.find((model) => model.id === modelId)}
          raw={parameterDrafts[modelId] ?? ''}
          onChange={(raw) => setParameterDrafts((previous) => ({ ...previous, [modelId]: raw }))}
        />
      ))}
      <Field
        label={t.settings.llm.apiKey}
        name="providerApiKey"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={t.settings.llm.apiKeyPlaceholder}
        autoComplete="new-password"
        spellCheck={false}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          loading={saving}
          disabled={apiKey.trim() === '' || picked.length === 0}
        >
          {t.settings.llm.add}
        </Button>
      </div>
    </form>
  );
}

function ProviderParameters({
  provider,
  catalog,
  onDone,
  onError,
  onTest,
}: {
  provider: LlmProviderPublic;
  catalog: CatalogProvider[];
  onDone: (next: LlmSettingsPublic) => void;
  onError: (message: string) => void;
  onTest: (model: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      provider.models.map((id) => [
        id,
        JSON.stringify(provider.modelParameters?.[id] ?? {}, null, 2),
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  return (
    <details className="pb-3">
      <summary className="cursor-pointer text-sm text-muted">
        配置模型参数 · {provider.label}
      </summary>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            setSaving(true);
            try {
              onDone(
                await client.patchLlmProvider(provider.id, {
                  modelParameters: parseModelParameters(provider.models, drafts),
                }),
              );
              setDirty(false);
            } catch (err) {
              onError(err instanceof Error ? err.message : humanError(err));
            } finally {
              setSaving(false);
            }
          })();
        }}
      >
        {provider.models.map((modelId) => (
          <div key={modelId}>
            <ModelParameters
              modelId={modelId}
              model={catalog
                .find((item) => item.id === provider.providerId)
                ?.models.find((model) => model.id === modelId)}
              raw={drafts[modelId] ?? ''}
              onChange={(raw) => {
                setDrafts((previous) => ({ ...previous, [modelId]: raw }));
                setDirty(true);
              }}
            />
            <Button
              type="button"
              variant="quiet"
              disabled={dirty || saving}
              onClick={() => onTest(modelId)}
            >
              测试 {modelId}
            </Button>
          </div>
        ))}
        <div>
          <Button type="submit" loading={saving}>
            保存模型参数
          </Button>
        </div>
        {dirty ? <p className="text-sm text-muted">保存参数后可测试连接。</p> : null}
      </form>
    </details>
  );
}

export function LlmSection() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const llm: LlmSettingsPublic = user?.llm ?? { providers: [], routing: {} };
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    client
      .llmCatalog()
      .then((res) => setCatalog(res.providers))
      .catch(() => setCatalog([]));
  }, []);

  function apply(next: LlmSettingsPublic) {
    if (user) setUser({ ...user, llm: next });
  }

  const modelOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (const provider of llm.providers) {
      for (const model of provider.models) {
        options.push({
          value: routeKey(provider.id, model),
          label: `${model} · ${provider.label}`,
        });
      }
    }
    return options;
  }, [llm.providers]);

  async function onRoute(capability: LlmCapability, value: string) {
    setError(null);
    const routing: LlmRouting = { ...llm.routing };
    if (value === '') {
      routing[capability] = null;
    } else {
      const [providerId, model] = value.split('::');
      routing[capability] = { providerId: providerId!, model: model! };
    }
    try {
      apply(await client.putLlmRouting({ routing }));
      setNotice(t.settings.llm.saved);
    } catch (err) {
      setError(humanError(err));
    }
  }

  async function onTest(provider: LlmProviderPublic, model = provider.models[0] ?? '') {
    setTestingId(provider.id);
    setError(null);
    setNotice(null);
    try {
      await client.testLlmProvider(provider.id, model);
      setNotice(t.settings.llm.testOk);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setTestingId(null);
    }
  }

  async function onRemove(provider: LlmProviderPublic) {
    setError(null);
    try {
      apply(await client.removeLlmProvider(provider.id));
    } catch (err) {
      setError(humanError(err));
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section>
        <h3 className="font-display text-[length:var(--text-section)] font-semibold">
          {t.settings.llm.providers}
        </h3>
        <p className="mt-1 text-[length:var(--text-meta)] text-muted">
          {t.settings.llm.providersHint}
        </p>
        <div className="mt-3 divide-y divide-border/60">
          {llm.providers.map((provider) => (
            <div key={provider.id}>
              <div className="flex items-center gap-3 py-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-muted font-display text-[length:var(--text-caption)] font-semibold text-muted">
                  {provider.label.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[length:var(--text-body)] font-medium">
                    {provider.label}
                  </p>
                  <p className="truncate text-[length:var(--text-caption)] text-muted">
                    {provider.baseUrl ?? provider.providerId} · {provider.models.join(', ')}
                  </p>
                </div>
                <span
                  className={`ml-auto inline-flex shrink-0 items-center gap-1.5 text-[length:var(--text-caption)] ${
                    provider.apiKeySet ? 'text-done' : 'text-due'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {provider.apiKeySet ? '已配置密钥' : t.settings.llm.keyMissing}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  loading={testingId === provider.id}
                  disabled={!provider.apiKeySet}
                  onClick={() => void onTest(provider)}
                >
                  {t.settings.llm.test}
                </Button>
                <Button type="button" variant="quiet" onClick={() => void onRemove(provider)}>
                  {t.settings.llm.removeProvider}
                </Button>
              </div>
              <ProviderParameters
                provider={provider}
                catalog={catalog}
                onDone={(next) => {
                  apply(next);
                  setError(null);
                  setNotice(t.settings.llm.saved);
                }}
                onError={setError}
                onTest={(model) => void onTest(provider, model)}
              />
            </div>
          ))}
        </div>
        {adding ? (
          <AddProviderForm
            catalog={catalog}
            onDone={(next) => {
              apply(next);
              setAdding(false);
              setNotice(t.settings.llm.saved);
            }}
            onError={setError}
          />
        ) : (
          <button
            type="button"
            className="mt-3 w-full rounded-[14px] border border-dashed border-border px-4 py-3 text-[length:var(--text-meta)] text-muted hover:border-accent hover:text-accent"
            onClick={() => setAdding(true)}
          >
            ＋ {t.settings.llm.addProvider}
          </button>
        )}
      </section>

      <section>
        <h3 className="font-display text-[length:var(--text-section)] font-semibold">
          {t.settings.llm.routing}
        </h3>
        <p className="mt-1 text-[length:var(--text-meta)] text-muted">
          {t.settings.llm.routingHint}
        </p>
        <div className="mt-3 divide-y divide-border/60">
          {LLM_CAPABILITIES.map((capability) => {
            const route = llm.routing[capability];
            const value = route ? routeKey(route.providerId, route.model) : '';
            return (
              <div key={capability} className="flex items-center gap-3 py-2.5">
                <span className="w-20 shrink-0 text-[length:var(--text-body)]">
                  {t.settings.llm.capabilities[capability]}
                </span>
                <span className="hidden text-[length:var(--text-caption)] text-muted sm:block">
                  {t.settings.llm.capabilityHints[capability]}
                </span>
                <SelectField
                  className="ml-auto w-56"
                  value={value}
                  ariaLabel={t.settings.llm.capabilities[capability]}
                  placeholder={
                    capability === 'default'
                      ? t.settings.llm.noProviderModels
                      : t.settings.llm.followDefault
                  }
                  disabled={modelOptions.length === 0}
                  options={[
                    ...(capability === 'default'
                      ? []
                      : [{ value: '', label: t.settings.llm.followDefault }]),
                    ...modelOptions,
                  ]}
                  onChange={(next) => void onRoute(capability, next)}
                />
              </div>
            );
          })}
        </div>
      </section>

      {error ? <Banner>{error}</Banner> : null}
      {notice ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
