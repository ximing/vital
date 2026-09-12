import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { useRouter } from 'expo-router';
import type { Theme } from '@vital/tokens';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Field } from '../../components/Field';
import { InboxComposeService } from './inbox.service';

const InboxComposeContent = observer(function InboxComposeContent({
  onClose,
}: {
  onClose?: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const s = useService(InboxComposeService);

  async function save(): Promise<void> {
    const item = await s.save();
    if (item === null) return;
    onClose?.();
    router.push(`/inbox/${item.id}`);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.embedded}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sheetTitle}>{copy.actions.create}</Text>
      <Field
        label={copy.fields.url}
        value={s.url}
        onChangeText={(url) => s.setUrl(url)}
        autoCapitalize="none"
        keyboardType="url"
        placeholder="https://"
      />
      <Button variant="secondary" loading={s.busy} onPress={() => void s.extract()} style={styles.btn}>
        {copy.actions.preview}
      </Button>
      <Field
        label={copy.fields.title}
        value={s.title}
        onChangeText={(title) => s.setTitle(title)}
        autoCapitalize="sentences"
      />
      <ErrorText message={s.error} />
      <Button fullWidth loading={s.busy} loadingText={copy.actions.saving} onPress={() => void save()}>
        {copy.actions.confirm}
      </Button>
    </ScrollView>
  );
});

export const InboxCompose = bindServices(InboxComposeContent, [InboxComposeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    btn: { alignSelf: 'flex-start', marginBottom: t.space[2] },
    embedded: { padding: t.space[4], gap: t.space[3] },
    sheetTitle: {
      fontSize: t.type.section.fontSize,
      lineHeight: t.type.section.lineHeight,
      fontWeight: '700',
      color: t.fgPrimary,
    },
  });
