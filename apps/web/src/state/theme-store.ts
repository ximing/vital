import { create } from 'zustand';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '@/lib/theme';

type ThemeState = {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  choice: typeof window === 'undefined' ? 'system' : getThemeChoice(),
  setChoice: (choice) => {
    setThemeChoice(choice);
    set({ choice });
  },
}));
