import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { rnShadow } from '../../ui/card';
import { InwitSectionService } from './inwit-section.service';

export const InwitSection = bindServices(
  observer(function InwitSection() {
    const t = useTheme();
    const styles = useMemo(() => createStyles(t), [t]);
    const s = useService(InwitSectionService);
    const [topicOpen, setTopicOpen] = useState(false);

    useEffect(() => {
      void s.load();
    }, [s]);

    const topicTitle =
      s.topics.find((topic) => topic.id === s.defaultTopicId)?.title ??
      copy.settings.inwit.defaultTopicHint;

    return (
      <View style={[styles.card, styles.cardFlush]}>
        <Field
          label={copy.settings.inwit.baseUrl}
          value={s.baseUrl}
          onChangeText={(value) => s.setBaseUrl(value)}
          placeholder={copy.settings.inwit.baseUrlHint}
          autoCapitalize="none"
          keyboardType="url"
        />
        <Field
          label={copy.settings.inwit.accessKey}
          value={s.accessKey}
          onChangeText={(value) => s.setAccessKey(value)}
          placeholder={
            s.accessKeySet
              ? copy.settings.inwit.accessKeySet
              : copy.settings.inwit.accessKeyPlaceholder
          }
          secureTextEntry
          autoCapitalize="none"
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setTopicOpen(true)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Field
            label={copy.settings.inwit.defaultTopic}
            value={topicTitle}
            editable={false}
            pointerEvents="none"
          />
        </Pressable>
        <View style={styles.btnRow}>
          <Button
            variant="secondary"
            size="sm"
            loading={s.testing}
            disabled={!s.accessKeySet}
            onPress={() => void s.test()}
          >
            {s.testing ? copy.settings.inwit.testing : copy.settings.inwit.test}
          </Button>
          <Button size="sm" loading={s.saving} onPress={() => void s.save()}>
            {copy.settings.inwit.save}
          </Button>
        </View>
        {!s.accessKeySet ? (
          <Text style={styles.hint}>{copy.settings.inwit.notConfigured}</Text>
        ) : null}
        <PickerSheet
          visible={topicOpen}
          title={copy.settings.inwit.defaultTopic}
          onClose={() => setTopicOpen(false)}
        >
          <PickerOption
            label={copy.settings.inwit.defaultTopicHint}
            selected={s.defaultTopicId === null}
            onPress={() => {
              s.setDefaultTopicId(null);
              setTopicOpen(false);
            }}
          />
          {s.topics.map((topic) => (
            <PickerOption
              key={topic.id}
              label={topic.title}
              selected={topic.id === s.defaultTopicId}
              onPress={() => {
                s.setDefaultTopicId(topic.id);
                setTopicOpen(false);
              }}
            />
          ))}
        </PickerSheet>
      </View>
    );
  }),
  [InwitSectionService],
);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.bgElevated,
      borderRadius: t.radius.lg,
      padding: 16,
      gap: 12,
      ...rnShadow,
    },
    cardFlush: { padding: 16 },
    btnRow: { flexDirection: 'row', gap: 8 },
    hint: { fontSize: t.type.meta.fontSize, color: t.textTertiary },
    pressed: { opacity: 0.7 },
  });
