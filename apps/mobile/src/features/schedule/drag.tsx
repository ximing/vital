import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, View, type StyleProp, type ViewStyle } from 'react-native';

type DragApi = {
  disabled: boolean;
  onGrant: (x: number, y: number) => void;
  onMove: (x: number, y: number) => void;
  onEnd: (x: number, y: number, moved: boolean) => void;
};

/** Claims the touch on press so a parent scroll view does not take the gesture. */
export function DragSurface({
  disabled = false,
  onGrant,
  onMove,
  onEnd,
  style,
  children,
  testID,
}: {
  disabled?: boolean;
  onGrant: (x: number, y: number) => void;
  onMove: (x: number, y: number) => void;
  onEnd: (x: number, y: number, moved: boolean) => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}) {
  const api = useRef<DragApi>({ disabled, onGrant, onMove, onEnd });
  const grant = useRef({ x: 0, y: 0 });
  useEffect(() => {
    api.current = { disabled, onGrant, onMove, onEnd };
  });
  /* eslint-disable react-hooks/refs -- PanResponder is created once; refs are read in gesture callbacks */
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => !api.current.disabled,
      onMoveShouldSetPanResponder: () => !api.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const x = event.nativeEvent.pageX;
        const y = event.nativeEvent.pageY;
        grant.current = { x, y };
        api.current.onGrant(x, y);
      },
      onPanResponderMove: (event) => {
        api.current.onMove(event.nativeEvent.pageX, event.nativeEvent.pageY);
      },
      onPanResponderRelease: (event) => {
        const x = event.nativeEvent.pageX;
        const y = event.nativeEvent.pageY;
        const moved = Math.abs(x - grant.current.x) > 6 || Math.abs(y - grant.current.y) > 6;
        api.current.onEnd(x, y, moved);
      },
      onPanResponderTerminate: () => {
        api.current.onEnd(grant.current.x, grant.current.y, false);
      },
    }),
  );
  /* eslint-enable react-hooks/refs */

  return (
    <View style={style} testID={testID} {...panResponder.panHandlers}>
      {children}
    </View>
  );
}
