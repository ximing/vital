import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@vital/tokens';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import type { SettingsHomeStyles } from './settings-home-styles';

export function SettingsAccountSection({
  t,
  styles,
  first,
  avatarUrl,
  avatarFailed,
  onAvatarError,
  initial,
  profileName,
  email,
  hasUser,
  displayName,
  onDisplayName,
  busy,
  profileDirty,
  onPickAvatar,
  onLogout,
  onSaveProfile,
}: {
  t: Theme;
  styles: SettingsHomeStyles;
  first: boolean;
  avatarUrl: string | null | undefined;
  avatarFailed: boolean;
  onAvatarError: () => void;
  initial: string;
  profileName: string | undefined;
  email: string | undefined;
  hasUser: boolean;
  displayName: string;
  onDisplayName: (value: string) => void;
  busy: boolean;
  profileDirty: boolean;
  onPickAvatar: () => void;
  onLogout: () => void;
  onSaveProfile: () => void;
}) {
  return (
    <>
      <SectionHead title={copy.settings.tabs.account} first={first} />
      <View style={styles.card}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            {avatarUrl && !avatarFailed ? (
              <Image
                source={{ uri: avatarUrl }}
                accessibilityLabel={copy.settings.avatarAlt}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onError={onAvatarError}
              />
            ) : (
              <Text style={styles.avatarInitial}>{initial}</Text>
            )}
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.displayName} numberOfLines={1}>
              {profileName || copy.settings.tabs.account}
            </Text>
            {hasUser ? (
              <Text style={styles.hint} numberOfLines={1}>
                {email}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.identityActions}>
          <Button variant="ghost" size="sm" loading={busy} onPress={onPickAvatar}>
            {copy.settings.changeAvatar}
          </Button>
          {/* 危险文字钮：Button 无 danger 文本变体（只有描边），按 §g 在本地实现 */}
          <Pressable
            accessibilityRole="button"
            hitSlop={t.space[2]}
            onPress={onLogout}
            style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressedSoft]}
          >
            <Text style={styles.logoutLabel}>{copy.auth.logout}</Text>
          </Pressable>
        </View>
        <Field
          label={copy.settings.displayName}
          value={displayName}
          onChangeText={onDisplayName}
          autoCapitalize="words"
        />
        <View style={styles.rowEnd}>
          <Button size="sm" loading={busy} disabled={!profileDirty} onPress={onSaveProfile}>
            {copy.settings.saveProfile}
          </Button>
        </View>
      </View>
    </>
  );
}
