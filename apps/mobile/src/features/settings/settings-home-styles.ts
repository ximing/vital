import { StyleSheet } from 'react-native';
import type { Theme } from '@vital/tokens';
import { rnShadow } from '../../ui/card';

export function createSettingsHomeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bgCanvas },
    scroll: { paddingHorizontal: t.space[4], paddingBottom: t.space[6] },
    bannerWrap: { marginTop: t.space[2], marginBottom: t.space[2] },
    card: {
      borderRadius: t.radius.lg,
      backgroundColor: t.bgElevated,
      padding: t.space[4],
      gap: t.space[3],
      ...rnShadow(t),
    },
    cardFlush: { padding: 0, gap: 0, overflow: 'hidden' },
    hairline: { height: StyleSheet.hairlineWidth, backgroundColor: t.borderSubtle },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      minHeight: t.space[12],
      paddingHorizontal: t.space[4],
    },
    rowPressed: { backgroundColor: t.bgSurfaceMuted },
    checkMark: { width: t.space[5], fontSize: 15, color: t.textTertiary },
    checkMarkDone: { color: t.statusDone },
    checkTitle: { flex: 1, fontSize: 15, color: t.fgPrimary },
    done: { color: t.fgMuted, textDecorationLine: 'line-through' },
    identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      overflow: 'hidden',
      backgroundColor: t.bgAccentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: { fontSize: 20, fontWeight: '700', color: t.accentPrimary },
    identityCopy: { flex: 1, minWidth: 0, gap: 2 },
    displayName: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: t.fgPrimary },
    identityActions: { flexDirection: 'row', alignItems: 'center', gap: t.space[2] },
    logoutBtn: { height: 32, justifyContent: 'center', paddingHorizontal: t.space[3] },
    logoutLabel: { fontSize: t.type.meta.fontSize, fontWeight: '500', color: t.danger },
    pressedSoft: { opacity: 0.7 },
    rowEnd: { flexDirection: 'row', justifyContent: 'flex-end' },
    hint: { fontSize: t.type.meta.fontSize, color: t.fgMuted },
    calendarLabel: { fontSize: 15, color: t.fgPrimary },
    limitPad: {
      gap: t.space[2],
      paddingHorizontal: t.space[4],
      paddingTop: t.space[3],
      paddingBottom: t.space[4],
    },
    limitError: { fontSize: t.type.meta.fontSize, color: t.danger },
    subHead: {
      fontSize: t.type.meta.fontSize,
      fontWeight: '600',
      color: t.fgMuted,
      marginTop: t.space[1],
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[3],
      minHeight: t.space[12],
    },
    rowLabel: { flex: 1, fontSize: 15, color: t.fgPrimary },
    btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
    progressBlock: { gap: t.space[2], paddingHorizontal: t.space[1], paddingTop: t.space[2] },
    track: {
      height: 8,
      borderRadius: 4,
      backgroundColor: t.bgSurfaceMuted,
      overflow: 'hidden',
    },
    fill: { height: 8, borderRadius: 4, backgroundColor: t.accentPrimary },
  });
}

export type SettingsHomeStyles = ReturnType<typeof createSettingsHomeStyles>;
