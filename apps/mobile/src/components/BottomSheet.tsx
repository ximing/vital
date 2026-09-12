import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';

export type BottomSheetRender = (opts: { full: boolean; onClose: () => void }) => ReactNode;

const SPRING = { tension: 90, friction: 12, overshootClamping: true, useNativeDriver: true } as const;

export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode | BottomSheetRender;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const rootRef = useRef<View>(null);
  const [hostH, setHostH] = useState(screenH);
  const [hostY, setHostY] = useState<number | null>(null);
  const fullH = Math.max(320, hostH);
  const midH = Math.round(fullH * 0.64);
  const midY = fullH - midH;
  const hiddenY = fullH;
  const [translateY] = useState(() => new Animated.Value(screenH));
  const yRef = useRef(screenH);
  const dragStartY = useRef(midY);
  const grantMoveY = useRef(0);
  const onCloseRef = useRef(onClose);
  const fullRef = useRef(false);
  const snapRef = useRef<(toY: number, after?: () => void) => void>(() => undefined);
  const geomRef = useRef({ fullH, midH, midY, hiddenY, translateY });
  const [full, setFull] = useState(false);
  if (!visible && full) setFull(false);
  const alreadyBelowStatus = hostY === null || hostY >= 8;
  const topPad = full && !alreadyBelowStatus ? insets.top : t.space[2];

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    fullRef.current = full;
  }, [full]);

  useEffect(() => {
    geomRef.current = { fullH, midH, midY, hiddenY, translateY };
  }, [fullH, midH, midY, hiddenY, translateY]);

  useEffect(() => {
    const id = translateY.addListener(({ value }) => {
      yRef.current = value;
    });
    return () => translateY.removeListener(id);
  }, [translateY]);

  useEffect(() => {
    if (!visible) {
      translateY.setValue(hiddenY);
      yRef.current = hiddenY;
      return;
    }
    translateY.setValue(hiddenY);
    yRef.current = hiddenY;
    Animated.spring(translateY, { toValue: midY, ...SPRING }).start();
  }, [visible, translateY, hiddenY, midY]);

  function snapToY(toY: number, after?: () => void): void {
    const nextFull = toY <= 8;
    fullRef.current = nextFull;
    setFull(nextFull);
    Animated.spring(translateY, { toValue: toY, ...SPRING }).start(({ finished }) => {
      if (finished) after?.();
    });
  }

  useEffect(() => {
    snapRef.current = snapToY;
  });

  /* eslint-disable react-hooks/refs -- PanResponder is created once; refs are read in gesture callbacks */
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        if (Math.abs(g.dy) < 6) return false;
        if (Math.abs(g.dx) > Math.abs(g.dy)) return false;
        if (!fullRef.current) return true;
        return g.dy > 6;
      },
      onMoveShouldSetPanResponderCapture: (_, g) => {
        if (Math.abs(g.dy) < 6) return false;
        if (Math.abs(g.dx) > Math.abs(g.dy)) return false;
        if (!fullRef.current) return true;
        return g.dy > 6;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, g) => {
        grantMoveY.current = g.moveY;
        geomRef.current.translateY.stopAnimation((value) => {
          yRef.current = value;
          dragStartY.current = value;
        });
        dragStartY.current = yRef.current;
      },
      onPanResponderMove: (_, g) => {
        const { hiddenY: hidden, translateY: ty } = geomRef.current;
        const dy = g.moveY - grantMoveY.current;
        const next = Math.min(hidden, Math.max(0, dragStartY.current + dy));
        yRef.current = next;
        ty.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const { fullH: maxH, midH: mid, midY: rest, hiddenY: hidden } = geomRef.current;
        const y = Math.min(
          hidden,
          Math.max(0, dragStartY.current + (g.moveY - grantMoveY.current)),
        );
        const h = maxH - y;
        if (h < mid * 0.55) {
          snapRef.current(hidden, () => onCloseRef.current());
          return;
        }
        if (h > mid + (maxH - mid) * 0.35) {
          snapRef.current(0);
          return;
        }
        snapRef.current(rest);
      },
      onPanResponderTerminate: (_, g) => {
        const { fullH: maxH, midH: mid, midY: rest, hiddenY: hidden } = geomRef.current;
        const y = Math.min(
          hidden,
          Math.max(0, dragStartY.current + (g.moveY - grantMoveY.current)),
        );
        const h = maxH - y;
        if (h < mid * 0.55) {
          snapRef.current(hidden, () => onCloseRef.current());
          return;
        }
        if (h > mid + (maxH - mid) * 0.35) {
          snapRef.current(0);
          return;
        }
        snapRef.current(rest);
      },
    }),
  );
  /* eslint-enable react-hooks/refs */

  function onRootLayout(): void {
    rootRef.current?.measureInWindow((_x, y, _w, h) => {
      if (h > 0) setHostH(h);
      setHostY(y);
    });
  }

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => onCloseRef.current()}>
      <View
        ref={rootRef}
        style={styles.root}
        pointerEvents="box-none"
        onLayout={onRootLayout}
      >
        <Pressable
          style={[styles.scrim, { backgroundColor: t.scrim }]}
          onPress={() => onCloseRef.current()}
        />
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.sheet,
            {
              height: fullH,
              paddingTop: topPad,
              paddingBottom: insets.bottom,
              borderTopLeftRadius: full ? 0 : t.radius.xl,
              borderTopRightRadius: full ? 0 : t.radius.xl,
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.handleWrap} pointerEvents="none">
            <View style={styles.handle} />
          </View>
          <View style={styles.body}>
            {typeof children === 'function' ? children({ full, onClose }) : children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.bgElevated,
      overflow: 'hidden',
    },
    handleWrap: {
      alignItems: 'center',
      paddingTop: 4,
      paddingBottom: 2,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.borderSubtle,
    },
    body: { flex: 1, minHeight: 0 },
  });
