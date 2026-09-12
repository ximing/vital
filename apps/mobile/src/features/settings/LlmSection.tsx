import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import {
  LLM_CAPABILITIES,
  type LlmCatalogProvider,
  type LlmProviderPublic,
  type LlmSettingsPublic,
} from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { parseModelParameters } from './llm';
import { LlmSectionService } from './llm-section.service';

function AddProviderForm({
  catalog,
  onDone,
}: {
  catalog: LlmCatalogProvider[];
  onDone: (next: LlmSettingsPublic) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [providerId, setProviderId] = useState(catalog[0]?.id ?? 'custom');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [modelDraft, setModelDraft] = useState('');
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const entry = catalog.find((item) => item.id === providerId);
  const isCustom = providerId === 'custom';
  const kindLabel = isCustom
    ? copy.settings.llm.customEndpoint
    : (entry?.name ?? providerId);

  function addModel(id: string): void {
    const next = id.trim();
    if (next === '' || picked.includes(next)) return;
    setPicked((current) => [...current, next]);
    setModelDraft('');
  }

  async function submit(): Promise<void> {
    if (apiKey.trim() === '' || picked.length === 0) return;
    setSaving(true);
    try {
      const next = await client.addLlmProvider({
        providerId,
        label:
          label.trim() ||
          (isCustom ? copy.settings.llm.customEndpoint : (entry?.name ?? providerId)),
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
        apiKey: apiKey.trim(),
        models: picked,
        ...(Object.keys(parameterDrafts).length > 0
          ? { modelParameters: parseModelParameters(picked, parameterDrafts) }
          : {}),
      });
      onDone(next);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.addCard}>
      <Pressable onPress={() => setKindOpen(true)} accessibilityRole="button">
        <Field
          label={copy.settings.llm.addProvider}
          value={kindLabel}
          editable={false}
          pointerEvents="none"
        />
      </Pressable>
      <Field
        label={copy.settings.llm.providerLabel}
        value={label}
        onChangeText={setLabel}
        placeholder={
          isCustom ? copy.settings.llm.providerLabelPlaceholder : (entry?.name ?? '')
        }
      />
      {isCustom ? (
        <Field
          label={copy.settings.llm.apiBase}
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder={copy.settings.llm.apiBaseHint}
        />
      ) : null}
      <Text style={styles.label}>{copy.settings.llm.providerModels}</Text>
      <View style={styles.chipRow}>
        {picked.map((id) => (
          <Pressable
            key={id}
            onPress={() => setPicked((current) => current.filter((item) => item !== id))}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={`${copy.settings.llm.removeProvider} ${id}`}
          >
            <Text style={styles.chipText}>{id} ×</Text>
          </Pressable>
        ))}
      </View>
      {entry && entry.models.length > 0 ? (
        <Button size="sm" variant="secondary" onPress={() => setCatalogOpen(true)}>
          {copy.settings.llm.pickFromCatalog}
        </Button>
      ) : null}
      <Field
        label={copy.settings.llm.model}
        value={modelDraft}
        onChangeText={setModelDraft}
        placeholder={copy.settings.llm.providerModelsCustomHint}
        onSubmitEditing={() => addModel(modelDraft)}
        returnKeyType="done"
      />
      <Button
        size="sm"
        variant="quiet"
        disabled={modelDraft.trim() === ''}
        onPress={() => addModel(modelDraft)}
      >
        {copy.settings.llm.addModel}
      </Button>
      <Field
        label={copy.settings.llm.apiKey}
        value={apiKey}
        onChangeText={setApiKey}
        secureTextEntry
        placeholder={copy.settings.llm.apiKeyPlaceholder}
      />
      <View style={styles.btnRow}>
        <Button
          size="sm"
          loading={saving}
          disabled={apiKey.trim() === '' || picked.length === 0}
          onPress={() => void submit()}
        >
          {copy.settings.llm.add}
        </Button>
      </View>
      <PickerSheet
        visible={kindOpen}
        title={copy.settings.llm.addProvider}
        onClose={() => setKindOpen(false)}
      >
        {catalog.map((item) => (
          <PickerOption
            key={item.id}
            label={item.name}
            selected={providerId === item.id}
            onPress={() => {
              setProviderId(item.id);
              setPicked([]);
              setParameterDrafts({});
              setKindOpen(false);
            }}
          />
        ))}
        <PickerOption
          label={copy.settings.llm.customEndpoint}
          selected={isCustom}
          onPress={() => {
            setProviderId('custom');
            setPicked([]);
            setParameterDrafts({});
            setKindOpen(false);
          }}
        />
      </PickerSheet>
      <PickerSheet
        visible={catalogOpen}
        title={copy.settings.llm.providerModels}
        onClose={() => setCatalogOpen(false)}
      >
        {(entry?.models ?? []).map((model) => (
          <PickerOption
            key={model.id}
            label={model.name}
            selected={picked.includes(model.id)}
            onPress={() => {
              setPicked((current) =>
                current.includes(model.id)
                  ? current.filter((id) => id !== model.id)
                  : [...current, model.id],
              );
            }}
          />
        ))}
      </PickerSheet>
    </View>
  );
}

function ProviderCard({
  provider,
  catalog,
  onDone,
}: {
  provider: LlmProviderPublic;
  catalog: LlmCatalogProvider[];
  onDone: (next: LlmSettingsPublic) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      provider.models.map((id) => [
        id,
        JSON.stringify(provider.modelParameters?.[id] ?? {}, null, 2),
      ]),
    ),
  );
  const [paramsOpen, setParamsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const catalogModels = catalog.find((item) => item.id === provider.providerId)?.models ?? [];

  async function saveParams(): Promise<void> {
    setSaving(true);
    try {
      onDone(
        await client.patchLlmProvider(provider.id, {
          modelParameters: parseModelParameters(provider.models, drafts),
        }),
      );
      setDirty(false);
      toast(copy.settings.llm.saved);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  async function test(model: string): Promise<void> {
    if (model === '' || dirty) return;
    setTesting(model);
    try {
      await client.testLlmProvider(provider.id, model);
      toast(copy.settings.llm.testOk);
    } catch (err) {
      toast(humanError(err));
    } finally {
      setTesting(null);
    }
  }

  return (
    <View style={styles.provider}>
      <View style={styles.providerHead}>
        <View style={styles.providerMark}>
          <Text style={styles.providerMarkText}>{provider.label.slice(0, 1)}</Text>
        </View>
        <View style={styles.providerCopy}>
          <Text style={styles.providerLabel}>{provider.label}</Text>
          <Text style={styles.providerMeta} numberOfLines={2}>
            {provider.baseUrl ?? provider.providerId} · {provider.models.join(', ')}
          </Text>
        </View>
      </View>
      <Text style={[styles.keyStatus, provider.apiKeySet ? styles.keyOk : styles.keyMissing]}>
        {provider.apiKeySet ? copy.settings.llm.keySet : copy.settings.llm.keyMissing}
      </Text>
      <View style={styles.btnRow}>
        <Button
          size="sm"
          variant="ghost"
          loading={testing === (provider.models[0] ?? '')}
          disabled={!provider.apiKeySet || dirty}
          onPress={() => void test(provider.models[0] ?? '')}
        >
          {copy.settings.llm.test}
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onPress={() =>
            void client
              .removeLlmProvider(provider.id)
              .then(onDone)
              .catch((err) => toast(humanError(err)))
          }
        >
          {copy.settings.llm.removeProvider}
        </Button>
      </View>
      <Pressable onPress={() => setParamsOpen((open) => !open)} accessibilityRole="button">
        <Text style={styles.paramsToggle}>
          {paramsOpen ? copy.settings.llm.hideParameters : copy.settings.llm.showParameters} ·{' '}
          {provider.label}
        </Text>
      </Pressable>
      {paramsOpen ? (
        <View style={styles.paramsBlock}>
          {provider.models.map((modelId) => (
            <View key={modelId} style={styles.gap}>
              <Field
                label={`${modelId} · ${copy.settings.llm.parametersJson}`}
                value={drafts[modelId] ?? ''}
                onChangeText={(raw) => {
                  setDrafts((previous) => ({ ...previous, [modelId]: raw }));
                  setDirty(true);
                }}
                multiline
                placeholder="{}"
              />
              <Button
                size="sm"
                variant="quiet"
                disabled={dirty || saving || !provider.apiKeySet}
                loading={testing === modelId}
                onPress={() => void test(modelId)}
              >
                {copy.settings.llm.test} {modelId}
              </Button>
            </View>
          ))}
          {catalogModels.length === 0 ? (
            <Text style={styles.hint}>{copy.settings.llm.parametersHint}</Text>
          ) : null}
          {dirty ? <Text style={styles.hint}>{copy.settings.llm.saveBeforeTest}</Text> : null}
          <Button size="sm" loading={saving} onPress={() => void saveParams()}>
            {copy.settings.llm.saveParameters}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const LlmSectionContent = observer(function LlmSectionContent() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const s = useService(LlmSectionService);
  useEffect(() => {
    void s.loadCatalog();
  }, [s]);

  const llm = s.llm;
  const catalog = s.catalog;
  const adding = s.adding;
  const routingFor = s.routingFor;
  const modelOptions = s.modelOptions;
  const routingTarget = s.routingTarget;

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.subHead}>{copy.settings.llm.providers}</Text>
        <Text style={styles.hint}>{copy.settings.llm.providersHint}</Text>
        {llm.providers.length === 0 ? (
          <Text style={styles.hint}>{copy.settings.llm.notConfigured}</Text>
        ) : null}
        {llm.providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            catalog={catalog}
            onDone={(next) => s.apply(next)}
          />
        ))}
        {adding ? (
          <AddProviderForm catalog={catalog} onDone={(next) => s.finishAdd(next)} />
        ) : (
          <Button size="sm" variant="secondary" onPress={() => s.openAdd()}>
            ＋ {copy.settings.llm.addProvider}
          </Button>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.subHead}>{copy.settings.llm.routing}</Text>
        <Text style={styles.hint}>{copy.settings.llm.routingHint}</Text>
        {LLM_CAPABILITIES.map((capability) => {
          const route = llm.routing[capability];
          const value = route ? `${route.model} · ${llm.providers.find((p) => p.id === route.providerId)?.label ?? ''}` : '';
          return (
            <Pressable
              key={capability}
              accessibilityRole="button"
              onPress={() => s.openRouting(capability)}
              style={styles.routeRow}
            >
              <View style={styles.routeCopy}>
                <Text style={styles.routeLabel}>{copy.settings.llm.capabilities[capability]}</Text>
                <Text style={styles.hint}>{copy.settings.llm.capabilityHints[capability]}</Text>
              </View>
              <Text style={styles.routeValue} numberOfLines={1}>
                {value ||
                  (capability === 'default'
                    ? copy.settings.llm.noProviderModels
                    : copy.settings.llm.followDefault)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <PickerSheet
        visible={routingFor !== null}
        title={
          routingFor ? copy.settings.llm.capabilities[routingFor] : copy.settings.llm.routing
        }
        onClose={() => s.closeRouting()}
      >
        {routingFor && routingFor !== 'default' ? (
          <PickerOption
            label={copy.settings.llm.followDefault}
            selected={routingTarget === ''}
            onPress={() => s.pickRoute('')}
          />
        ) : null}
        {modelOptions.map((option) => (
          <PickerOption
            key={option.value}
            label={option.label}
            selected={option.value === routingTarget}
            onPress={() => s.pickRoute(option.value)}
          />
        ))}
      </PickerSheet>
    </View>
  );
});

export const LlmSection = bindServices(LlmSectionContent, [LlmSectionService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    stack: { gap: t.space[3] },
    card: {
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      padding: t.space[4],
      gap: t.space[3],
      ...rnShadow(t),
    },
    addCard: {
      gap: t.space[3],
      paddingTop: t.space[2],
    },
    subHead: { fontSize: t.type.meta.fontSize, fontWeight: '600', color: t.fgMuted },
    hint: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    label: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    chip: {
      borderRadius: t.radius.pill,
      backgroundColor: t.bgAccentSubtle,
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[1],
    },
    chipText: { fontSize: t.type.caption.fontSize, color: t.accentPrimary },
    btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    provider: { gap: t.space[2], paddingTop: t.space[2] },
    providerHead: { flexDirection: 'row', alignItems: 'center', gap: t.space[3] },
    providerMark: {
      width: 32,
      height: 32,
      borderRadius: t.radius.md,
      backgroundColor: t.bgSurfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    providerMarkText: { fontSize: t.type.caption.fontSize, fontWeight: '700', color: t.fgMuted },
    providerCopy: { flex: 1, minWidth: 0, gap: 2 },
    providerLabel: { fontSize: 15, fontWeight: '600', color: t.fgPrimary },
    providerMeta: { fontSize: t.type.caption.fontSize, color: t.fgMuted },
    keyStatus: { fontSize: t.type.caption.fontSize },
    keyOk: { color: t.statusDone },
    keyMissing: { color: t.statusOverdue },
    paramsToggle: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    paramsBlock: { gap: t.space[3] },
    gap: { gap: t.space[2] },
    routeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      minHeight: t.space[12],
    },
    routeCopy: { flex: 1, minWidth: 0, gap: 2 },
    routeLabel: { fontSize: 15, color: t.fgPrimary },
    routeValue: { maxWidth: '42%', fontSize: t.type.caption.fontSize, color: t.textTertiary, textAlign: 'right' },
  });
