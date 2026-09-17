import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  emptyLlmCostRatesDraft,
  llmCostIsPriced,
  parseLlmModelPricingDraft,
  type LlmCatalogModel,
  type LlmCostRateKey,
  type LlmModelPricingDraft,
} from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Field } from '../../components/Field';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';

const RATE_FIELDS: { key: LlmCostRateKey; label: string }[] = [
  { key: 'input', label: copy.settings.llm.pricingInput },
  { key: 'output', label: copy.settings.llm.pricingOutput },
  { key: 'cacheRead', label: copy.settings.llm.pricingCacheRead },
  { key: 'cacheWrite', label: copy.settings.llm.pricingCacheWrite },
];

function catalogHint(model?: LlmCatalogModel): string {
  const cost = model?.cost;
  if (!cost || !llmCostIsPriced(cost)) return copy.settings.llm.pricingCatalogUnpriced;
  return copy.settings.llm.pricingCatalog
    .replace('{input}', String(cost.input))
    .replace('{output}', String(cost.output));
}

function placeholderFor(model: LlmCatalogModel | undefined, key: LlmCostRateKey): string {
  const cost = model?.cost?.[key];
  return cost !== undefined && cost > 0 ? String(cost) : '—';
}

export function ModelPricing({
  modelId,
  model,
  draft,
  onChange,
}: {
  modelId: string;
  model?: LlmCatalogModel;
  draft: LlmModelPricingDraft;
  onChange: (next: LlmModelPricingDraft) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  let error = '';
  try {
    parseLlmModelPricingDraft(draft);
  } catch (err) {
    error = err instanceof Error ? err.message : copy.settings.llm.parametersJson;
  }

  return (
    <View style={styles.block}>
      <Text style={styles.head}>
        {copy.settings.llm.pricing} · {modelId}
      </Text>
      <Text style={styles.hint}>
        {catalogHint(model)}。{copy.settings.llm.pricingHint}
      </Text>
      {RATE_FIELDS.map((field) => (
        <Field
          key={field.key}
          label={`${field.label} · ${field.key}`}
          value={draft[field.key]}
          onChangeText={(value) => onChange({ ...draft, [field.key]: value })}
          keyboardType="decimal-pad"
          placeholder={placeholderFor(model, field.key)}
        />
      ))}
      {draft.windows.map((window, index) => (
        <View key={index} style={styles.window}>
          <View style={styles.windowHead}>
            <Text style={styles.windowTitle}>
              {copy.settings.llm.pricingWindow} {index + 1}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.settings.llm.pricingRemoveWindow}
              onPress={() =>
                onChange({ ...draft, windows: draft.windows.filter((_, i) => i !== index) })
              }
            >
              <Text style={styles.remove}>{copy.settings.llm.pricingRemoveWindow}</Text>
            </Pressable>
          </View>
          <Field
            label={copy.settings.llm.pricingWindowStart}
            value={window.start}
            onChangeText={(start) =>
              onChange({
                ...draft,
                windows: draft.windows.map((item, i) => (i === index ? { ...item, start } : item)),
              })
            }
            placeholder="00:00"
          />
          <Field
            label={copy.settings.llm.pricingWindowEnd}
            value={window.end}
            onChangeText={(end) =>
              onChange({
                ...draft,
                windows: draft.windows.map((item, i) => (i === index ? { ...item, end } : item)),
              })
            }
            placeholder="08:00"
          />
          {RATE_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={`${field.label} · ${field.key}`}
              value={window[field.key]}
              onChangeText={(value) =>
                onChange({
                  ...draft,
                  windows: draft.windows.map((item, i) =>
                    i === index ? { ...item, [field.key]: value } : item,
                  ),
                })
              }
              keyboardType="decimal-pad"
              placeholder={placeholderFor(model, field.key)}
            />
          ))}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          onChange({
            ...draft,
            windows: [...draft.windows, { start: '00:00', end: '08:00', ...emptyLlmCostRatesDraft() }],
          })
        }
      >
        <Text style={styles.add}>{copy.settings.llm.pricingAddWindow}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    block: { gap: theme.space[2] },
    head: { fontSize: theme.type.meta.fontSize, fontWeight: '600', color: theme.fgPrimary },
    hint: { fontSize: theme.type.meta.fontSize, color: theme.fgMuted },
    window: {
      gap: theme.space[2],
      paddingTop: theme.space[2],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.borderSubtle,
    },
    windowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    windowTitle: { fontSize: theme.type.meta.fontSize, fontWeight: '600', color: theme.fgPrimary },
    remove: { fontSize: theme.type.caption.fontSize, color: theme.fgMuted },
    add: { fontSize: theme.type.meta.fontSize, color: theme.accentPrimary },
    error: { fontSize: theme.type.caption.fontSize, color: theme.danger },
  });
