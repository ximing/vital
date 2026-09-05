import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onAuthCleared } from '../lib/token-store';
import { useTheme } from '../theme/use-theme';
import type { Theme } from '@vital/tokens';
import { Button } from './Button';
import { bindToastHost, UNDO_MS, type ToastItem } from './toast';

export function ToastHost() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<ToastItem | null>(null);
  const opacity = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    return bindToastHost({
      show: (next) => {
        setItem(next);
      },
      clear: () => {
        setItem(null);
      },
    });
  }, []);

  useEffect(() => onAuthCleared(() => setItem(null)), []);

  useEffect(() => {
    if (item === null) {
      opacity.setValue(0);
      return;
    }
    let cancelled = false;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: t.motion.inMs,
      useNativeDriver: true,
    }).start();
    const duration = item.durationMs ?? (item.action ? UNDO_MS : 3000);
    const id = setTimeout(() => {
      if (cancelled) return;
      Animated.timing(opacity, {
        toValue: 0,
        duration: t.motion.outMs,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !cancelled) setItem(null);
      });
    }, duration);
    return () => {
      cancelled = true;
      clearTimeout(id);
      opacity.stopAnimation();
    };
  }, [item, opacity, t.motion.inMs, t.motion.outMs]);

  if (item === null) return null;

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="summary"
        style={[styles.toast, { bottom: insets.bottom + t.space[4], opacity }]}
      >
        <Pressable style={styles.body} onPress={() => setItem(null)}>
          <Text style={styles.message}>{item.message}</Text>
        </Pressable>
        {item.action ? (
          <Button
            variant="quiet"
            onPress={() => {
              item.action?.onPress();
              setItem(null);
            }}
          >
            {item.action.label}
          </Button>
        ) : null}
      </Animated.View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    layer: {
      ...StyleSheet.absoluteFillObject,
      zIndex: t.z.toast,
    },
    toast: {
      position: 'absolute',
      left: t.space[4],
      right: t.space[4],
      minHeight: t.controlHProminent,
      borderRadius: t.radius.lg,
      backgroundColor: t.bgSurface,
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[3],
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      shadowColor: t.fgPrimary,
      shadowOpacity: t.scheme === 'dark' ? 0.42 : 0.18,
      shadowRadius: t.space[5],
      shadowOffset: { width: 0, height: t.space[4] },
      elevation: t.space[2],
    },
    body: { flex: 1, minWidth: 0 },
    message: { fontSize: t.type.meta.fontSize, color: t.fgPrimary },
  });
