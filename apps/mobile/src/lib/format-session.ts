import { useCallback, useEffect, useRef, useState } from 'react';
import type { TextSelection } from './markdown-format';

const LEAVE_MS = 200;
const TOUCH_HOLD_MS = 500;

/**
 * Keeps a markdown field in edit mode while a format control is touched.
 * Blur fires before the button press on Android; leaving immediately unmounts the control.
 */
export function useFormatSession() {
  const selection = useRef<TextSelection>({ start: 0, end: 0 });
  const getSelection = useCallback(() => selection.current, []);
  const setSelection = useCallback((next: TextSelection) => {
    selection.current = next;
  }, []);
  const touchHold = useRef(false);
  const pinned = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [forced, setForced] = useState<TextSelection | null>(null);

  const holding = useCallback(() => touchHold.current || pinned.current, []);

  const cancelLeave = useCallback(() => {
    if (leaveTimer.current !== null) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const beginHold = useCallback(() => {
    touchHold.current = true;
    cancelLeave();
    if (touchTimer.current !== null) clearTimeout(touchTimer.current);
    touchTimer.current = setTimeout(() => {
      touchTimer.current = null;
      touchHold.current = false;
    }, TOUCH_HOLD_MS);
  }, [cancelLeave]);

  const setPinned = useCallback(
    (next: boolean) => {
      pinned.current = next;
      if (next) cancelLeave();
    },
    [cancelLeave],
  );

  const scheduleLeave = useCallback(
    (leave: () => void) => {
      cancelLeave();
      const tick = (): void => {
        leaveTimer.current = setTimeout(() => {
          leaveTimer.current = null;
          if (holding()) {
            tick();
            return;
          }
          leave();
        }, LEAVE_MS);
      };
      tick();
    },
    [cancelLeave, holding],
  );

  useEffect(
    () => () => {
      cancelLeave();
      if (touchTimer.current !== null) clearTimeout(touchTimer.current);
    },
    [cancelLeave],
  );

  return {
    getSelection,
    setSelection,
    forced,
    setForced,
    beginHold,
    setPinned,
    scheduleLeave,
    cancelLeave,
    holding,
  };
}
