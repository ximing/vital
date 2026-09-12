import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { BottomSheet } from './BottomSheet';
import { TaskSheet } from '../features/todos/TaskSheet';

const OpenTaskContext = createContext<(id: string) => void>(() => undefined);

export function useOpenTask(): (id: string) => void {
  return useContext(OpenTaskContext);
}

export function TaskSheetHost({ children }: { children: ReactNode }) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = useCallback((id: string) => {
    if (id !== '') setOpenTaskId(id);
  }, []);
  const value = useMemo(() => openTask, [openTask]);

  return (
    <OpenTaskContext.Provider value={value}>
      {children}
      <BottomSheet visible={openTaskId !== null} onClose={() => setOpenTaskId(null)}>
        {({ full, onClose }) =>
          openTaskId ? <TaskSheet key={openTaskId} taskId={openTaskId} full={full} onClose={onClose} /> : null
        }
      </BottomSheet>
    </OpenTaskContext.Provider>
  );
}
