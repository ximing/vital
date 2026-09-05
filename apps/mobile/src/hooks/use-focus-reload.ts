import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

export function useFocusReload(load: () => Promise<void>): void {
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
}
