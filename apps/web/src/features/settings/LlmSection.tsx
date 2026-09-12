import {
  LLM_CAPABILITIES,
  type LlmCapability,
  type LlmProviderPublic,
  type LlmSettingsPublic,
} from '@vital/dto';
import { bindServices, useService } from '@rabjs/react';
import { useEffect, useMemo, type FC, type FormEvent } from 'react';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { SelectField } from '@/ui/select-field';
import { ModelSelect } from './ModelSelect';
import { ModelParameters } from './ModelParameters';
import {
  AddProviderService,
  LlmSectionService,
  ProviderParametersService,
  llmRouteKey,
  type CatalogProvider,
} from './llm.service';

function AddProviderFormContent({
  catalog,
  onDone,
  onError,
}: {
  catalog: CatalogProvider[];
  onDone: (next: LlmSettingsPublic) => void;
  onError: (message: string) => void;
}) {
  const page = useService(AddProviderService);
  const entry = catalog.find((item) => item.id === page.providerId);
  const isCustom = page.providerId === 'custom';
  const saving = page.$model.submit.loading;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      onDone(await page.submit(catalog));
    } catch (err) {
      onError(humanError(err));
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="mt-3 flex flex-col gap-3 rounded-[14px] border border-border bg-elevated p-4"
    >
      <SelectField
        value={page.providerId}
        ariaLabel={t.settings.llm.addProvider}
        options={[
          ...catalog.map((item) => ({ value: item.id, label: item.name })),
          { value: 'custom', label: t.settings.llm.customEndpoint },
        ]}
        onChange={(next) => page.setProviderId(next)}
      />
      <Field
        label={t.settings.llm.providerLabel}
        name="providerLabel"
        value={page.label}
        onChange={(e) => page.setLabel(e.target.value)}
        placeholder={isCustom ? t.settings.llm.providerLabelPlaceholder : (entry?.name ?? '')}
        autoComplete="off"
        spellCheck={false}
      />
      {isCustom ? (
        <Field
          label={t.settings.llm.apiBase}
          name="providerBaseUrl"
          value={page.baseUrl}
          onChange={(e) => page.setBaseUrl(e.target.value)}
          placeholder={t.settings.llm.apiBaseHint}
          autoComplete="off"
          spellCheck={false}
        />
      ) : null}
      <ModelSelect
        key={page.providerId}
        options={entry?.models ?? []}
        value={page.picked}
        onChange={(next) => page.setPicked(next)}
      />
      {page.picked.map((modelId) => (
        <ModelParameters
          key={modelId}
          modelId={modelId}
          model={entry?.models.find((model) => model.id === modelId)}
          raw={page.parameterDrafts[modelId] ?? ''}
          onChange={(raw) => page.setParameterDraft(modelId, raw)}
        />
      ))}
      <Field
        label={t.settings.llm.apiKey}
        name="providerApiKey"
        type="password"
        value={page.apiKey}
        onChange={(e) => page.setApiKey(e.target.value)}
        placeholder={t.settings.llm.apiKeyPlaceholder}
        autoComplete="new-password"
        spellCheck={false}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          loading={saving}
          disabled={page.apiKey.trim() === '' || page.picked.length === 0}
        >
          {t.settings.llm.add}
        </Button>
      </div>
    </form>
  );
}

const AddProviderForm: FC<{
  catalog: CatalogProvider[];
  onDone: (next: LlmSettingsPublic) => void;
  onError: (message: string) => void;
}> = bindServices(AddProviderFormContent, [AddProviderService]);

function ProviderParametersContent({
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
  const page = useService(ProviderParametersService);
  page.adopt(provider);
  const saving = page.$model.save.loading;

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
            try {
              onDone(await page.save(provider));
            } catch (err) {
              onError(err instanceof Error ? err.message : humanError(err));
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
              raw={page.drafts[modelId] ?? ''}
              onChange={(raw) => page.setDraft(modelId, raw)}
            />
            <Button
              type="button"
              variant="quiet"
              disabled={page.dirty || saving}
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
        {page.dirty ? <p className="text-sm text-muted">保存参数后可测试连接。</p> : null}
      </form>
    </details>
  );
}

const ProviderParameters: FC<{
  provider: LlmProviderPublic;
  catalog: CatalogProvider[];
  onDone: (next: LlmSettingsPublic) => void;
  onError: (message: string) => void;
  onTest: (model: string) => void;
}> = bindServices(ProviderParametersContent, [ProviderParametersService]);

function LlmSectionContent() {
  const page = useService(LlmSectionService);
  const llm = page.llm;

  useEffect(() => {
    void page.loadCatalog();
  }, [page]);

  const modelOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (const provider of llm.providers) {
      for (const model of provider.models) {
        options.push({
          value: llmRouteKey(provider.id, model),
          label: `${model} · ${provider.label}`,
        });
      }
    }
    return options;
  }, [llm.providers]);

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
                  loading={page.testingId === provider.id}
                  disabled={!provider.apiKeySet}
                  onClick={() => void page.test(provider)}
                >
                  {t.settings.llm.test}
                </Button>
                <Button type="button" variant="quiet" onClick={() => void page.remove(provider)}>
                  {t.settings.llm.removeProvider}
                </Button>
              </div>
              <ProviderParameters
                provider={provider}
                catalog={page.catalog}
                onDone={(next) => {
                  page.apply(next);
                  page.setError(null);
                  page.setNotice(t.settings.llm.saved);
                }}
                onError={(message) => page.setError(message)}
                onTest={(model) => void page.test(provider, model)}
              />
            </div>
          ))}
        </div>
        {page.adding ? (
          <AddProviderForm
            catalog={page.catalog}
            onDone={(next) => {
              page.apply(next);
              page.setAdding(false);
              page.setNotice(t.settings.llm.saved);
            }}
            onError={(message) => page.setError(message)}
          />
        ) : (
          <button
            type="button"
            className="mt-3 w-full rounded-[14px] border border-dashed border-border px-4 py-3 text-[length:var(--text-meta)] text-muted hover:border-accent hover:text-accent"
            onClick={() => page.setAdding(true)}
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
          {LLM_CAPABILITIES.map((capability: LlmCapability) => {
            const route = llm.routing[capability];
            const value = route ? llmRouteKey(route.providerId, route.model) : '';
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
                  onChange={(next) => void page.saveRoute(capability, next)}
                />
              </div>
            );
          })}
        </div>
      </section>

      {page.error ? <Banner>{page.error}</Banner> : null}
      {page.notice ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {page.notice}
        </p>
      ) : null}
    </div>
  );
}

export const LlmSection: FC = bindServices(LlmSectionContent, [LlmSectionService]);
