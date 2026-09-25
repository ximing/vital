import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { TaskSheet } from '../features/todos/TaskSheet';

const OpenTaskContext = createContext<(id: string) => void>(() => undefined);

export function useOpenTask(): (id: string) => void {
  return useContext(OpenTaskContext);
}

export function TaskSheetHost({ children }: { children: ReactNode }) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const openTask = useCallback((id: string) => {
    if (id !== '') setOpenTaskId(id);
  }, []);
  const registerFlush = useCallback((flush: (() => Promise<void>) | null) => {
    flushRef.current = flush;
  }, []);
  const closeSheet = useCallback(() => {
    Keyboard.dismiss();
    const flush = flushRef.current;
    void (async () => {
      // Let a blur/end-editing event commit the last keystrokes before flush.
      await new Promise((resolve) => setTimeout(resolve, 32));
      try {
        await flush?.();
      } catch {
        // Save errors toast inside the sheet; closing still drops the draft only if the request failed.
      }
      setOpenTaskId(null);
    })();
  }, []);
  const value = useMemo(() => openTask, [openTask]);

  return (
    <OpenTaskContext.Provider value={value}>
      {children}
      <BottomSheet visible={openTaskId !== null} onClose={closeSheet}>
        {({ full, onClose }) =>
          openTaskId ? (
            <TaskSheet
              key={openTaskId}
              taskId={openTaskId}
              full={full}
              onClose={onClose}
              onOpenTask={openTask}
              registerFlush={registerFlush}
            />
          ) : null
        }
      </BottomSheet>
    </OpenTaskContext.Provider>
  );
}
