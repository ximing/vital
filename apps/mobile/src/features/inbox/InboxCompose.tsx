import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import type { InboxPreview } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { useAuth } from '../../auth/AuthProvider';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { markOnboarding } from '../../lib/onboarding';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { toast } from '../../components/toast';

export function InboxCompose() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const auth = useAuth();
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState<InboxPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function extract(): Promise<void> {
    const trimmed = url.trim();
    if (trimmed === '') return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.extractInbox({ url: trimmed });
      setPreview(next);
      if (title.trim() === '') setTitle(next.title);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    const trimmedTitle = (title.trim() || preview?.title || '').trim();
    if (trimmedTitle === '') {
      setError(copy.auth.invalidRegister);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const href = url.trim();
      const item = await client.createInbox({
        title: trimmedTitle,
        originalUrl: href.startsWith('http://') || href.startsWith('https://') ? href : null,
        extractedText: preview?.extractedText ?? null,
        extractedHtml: preview?.extractedHtml ?? null,
        excerpt: preview?.excerpt ?? null,
        byline: preview?.byline ?? null,
        siteName: preview?.siteName ?? null,
        source: href === '' ? 'manual' : 'mobile',
      });
      toast(copy.toast.saved);
      await markOnboarding(auth.user, auth.refreshUser, { capturedInbox: true });
      router.replace(`/inbox/${item.id}`);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.actions.create }} />
      <Field
        label={copy.fields.url}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        keyboardType="url"
        placeholder="https://"
      />
      <Button variant="secondary" loading={busy} onPress={() => void extract()} style={styles.btn}>
        {copy.actions.preview}
      </Button>
      <Field label={copy.fields.title} value={title} onChangeText={setTitle} autoCapitalize="sentences" />
      <ErrorText message={error} />
      <Button fullWidth loading={busy} loadingText={copy.actions.saving} onPress={() => void save()}>
        {copy.actions.confirm}
      </Button>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    btn: { alignSelf: 'flex-start', marginBottom: t.space[2] },
  });
