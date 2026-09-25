import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from '@vital/tokens';
import { useTheme } from '../theme/use-theme';
import { sheetShadow } from '../ui/card';
import { shouldDragSheet, sheetSnapY } from './bottom-sheet-gesture';

export type BottomSheetRender = (opts: { full: boolean; onClose: () => void }) => ReactNode;

const SheetExpandContext = createContext<() => void>(() => undefined);

/** Expand the surrounding sheet to the top. No-op outside a BottomSheet. */
export function useSheetExpand(): () => void {
  return useContext(SheetExpandContext);
}

const SheetScrollContext = createContext({
  start: (_y: number) => undefined as void,
  update: (_y: number) => undefined as void,
});

/** Connect the sheet's main ScrollView so downward drags only collapse it at the top. */
export function useSheetScroll(full: boolean) {
  const bridge = useContext(SheetScrollContext);
  const offset = useRef(0);
  const ref = useRef<ScrollView>(null);
  const startY = useRef<number | null>(null);

  function restoreScroll(): void {
    startY.current = null;
    ref.current?.setNativeProps({ scrollEnabled: full });
  }

  return {
    ref,
    onTouchStart: (event: GestureResponderEvent) => {
      bridge.start(offset.current);
      if (
        Platform.OS === 'android' &&
        full &&
        offset.current <= 0 &&
        event.nativeEvent.touches.length === 1
      ) {
        // Android's native ScrollView otherwise intercepts downward moves before
        // the JS responder can claim them, even when already at the top.
        startY.current = event.nativeEvent.pageY;
        ref.current?.setNativeProps({ scrollEnabled: false });
      }
    },
    onTouchMove: (event: GestureResponderEvent) => {
      if (startY.current === null) return;
      if (event.nativeEvent.touches.length !== 1 || event.nativeEvent.pageY < startY.current - 6) {
        restoreScroll();
      }
    },
    onTouchEnd: restoreScroll,
    onTouchCancel: restoreScroll,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = Math.max(0, event.nativeEvent.contentOffset.y);
      bridge.update(offset.current);
    },
    scrollEventThrottle: 16,
  };
}

const SPRING = {
  tension: 90,
  friction: 12,
  overshootClamping: true,
  useNativeDriver: false,
} as const;

export function BottomSheet({
  visible,
  onClose,
  children,
  openFull = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode | BottomSheetRender;
  /** Open at the top of the screen. Forms that need the keyboard use this. */
  openFull?: boolean;
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
  const scrollY = useRef(0);
  const touchInScroll = useRef(false);
  const snapRef = useRef<(toY: number, after?: () => void) => void>(() => undefined);
  const geomRef = useRef({ fullH, midH, midY, hiddenY, translateY });
  const [full, setFull] = useState(false);
  if (!visible && full) setFull(false);
  if (visible && openFull && !full) setFull(true);
  const alreadyBelowStatus = hostY === null || hostY >= 8;
  const topPad = full && !alreadyBelowStatus ? insets.top : t.space[2];
  // The sheet view is screen-tall and slides down. Only its top slice stays on screen,
  // so the content column must be that slice — otherwise the toolbar lays out offscreen.
  // Height is animated with the translation, keeping the toolbar at the visible bottom.
  const frameH = translateY.interpolate({
    inputRange: [0, Math.max(1, fullH - topPad - insets.bottom)],
    outputRange: [Math.max(0, fullH - topPad - insets.bottom), 0],
    extrapolate: 'clamp',
  });
  const scrollBridge = useMemo(
    () => ({
      start: (y: number) => {
        touchInScroll.current = true;
        scrollY.current = y;
      },
      update: (y: number) => {
        scrollY.current = y;
      },
    }),
    [],
  );

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
      fullRef.current = false;
      scrollY.current = 0;
      touchInScroll.current = false;
      translateY.setValue(hiddenY);
      yRef.current = hiddenY;
      return;
    }
    const dest = openFull ? 0 : midY;
    translateY.setValue(hiddenY);
    yRef.current = hiddenY;
    if (openFull) fullRef.current = true;
    Animated.spring(translateY, { toValue: dest, ...SPRING }).start();
  }, [visible, translateY, hiddenY, midY, openFull]);

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

  const expand = useCallback(() => {
    snapRef.current(0);
  }, []);

  function wantsDrag(dx: number, dy: number): boolean {
    return shouldDragSheet(fullRef.current, touchInScroll.current ? scrollY.current : 0, dx, dy);
  }

  function settleDrag(): void {
    const { fullH: maxH, midH: mid, hiddenY: hidden } = geomRef.current;
    const toY = sheetSnapY(yRef.current, maxH, mid);
    snapRef.current(toY, toY === hidden ? () => onCloseRef.current() : undefined);
  }

  /* eslint-disable react-hooks/refs -- PanResponder is created once; refs are read in gesture callbacks */
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => {
        touchInScroll.current = false;
        return false;
      },
      onMoveShouldSetPanResponder: (_, g) => wantsDrag(g.dx, g.dy),
      onMoveShouldSetPanResponderCapture: (_, g) => wantsDrag(g.dx, g.dy),
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
      onPanResponderRelease: settleDrag,
      onPanResponderTerminate: settleDrag,
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
      <View ref={rootRef} style={styles.root} pointerEvents="box-none" onLayout={onRootLayout}>
        <Pressable
          style={[styles.scrim, { backgroundColor: t.scrim }]}
          onPress={() => onCloseRef.current()}
        />
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.sheet,
            sheetShadow(t),
            {
              height: fullH,
              borderTopLeftRadius: full ? 0 : t.radius.xl,
              borderTopRightRadius: full ? 0 : t.radius.xl,
              transform: [{ translateY }],
            },
          ]}
        >
          <View
            style={[
              styles.clip,
              {
                borderTopLeftRadius: full ? 0 : t.radius.xl,
                borderTopRightRadius: full ? 0 : t.radius.xl,
                paddingTop: topPad,
                paddingBottom: insets.bottom,
              },
            ]}
          >
          <Animated.View
            style={{ height: frameH }}
            // Claim otherwise-unhandled touches before Modal's root responder does.
            // This is the bubble phase: buttons/inputs keep taps, and the outer pan
            // responder can take over vertical drags even when they start on blank space.
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => true}
          >
            <View style={styles.handleWrap} pointerEvents="none">
              <View style={styles.handle} />
            </View>
            <View style={styles.body}>
              <SheetExpandContext.Provider value={expand}>
                <SheetScrollContext.Provider value={scrollBridge}>
                  {typeof children === 'function' ? children({ full, onClose }) : children}
                </SheetScrollContext.Provider>
              </SheetExpandContext.Provider>
            </View>
          </Animated.View>
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
    },
    clip: {
      flex: 1,
      backgroundColor: t.bgElevated,
      overflow: 'hidden',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borderSubtle,
    },
    handleWrap: {
      alignItems: 'center',
      paddingTop: 6,
      paddingBottom: 4,
    },
    handle: {
      width: 40,
      height: 5,
      borderRadius: t.radius.pill,
      backgroundColor: t.textTertiary,
    },
    body: { flex: 1, minHeight: 0 },
  });
