import type { ReportEmbeds } from '@vital/dto';
import { create } from 'zustand';
import { EMPTY_EMBEDS, type SlashQuery } from './model';

type ReportUi = {
  embeds: ReportEmbeds;
  lastCompletionId: Record<string, string>;
  slash: SlashQuery | null;
  setEmbeds: (embeds: ReportEmbeds) => void;
  mergeEmbeds: (embeds: ReportEmbeds) => void;
  setSlash: (slash: SlashQuery | null) => void;
  setCompletionId: (taskId: string, completionId: string) => void;
};

const initial = {
  embeds: EMPTY_EMBEDS,
  lastCompletionId: {} as Record<string, string>,
  slash: null as SlashQuery | null,
};

export const useReportUi = create<ReportUi>((set) => ({
  ...initial,
  setEmbeds: (embeds) => set({ embeds }),
  mergeEmbeds: (embeds) =>
    set((s) => ({
      embeds: {
        tasks: { ...s.embeds.tasks, ...embeds.tasks },
        inbox: { ...s.embeds.inbox, ...embeds.inbox },
      },
    })),
  setSlash: (slash) => set({ slash }),
  setCompletionId: (taskId, completionId) =>
    set((s) => ({ lastCompletionId: { ...s.lastCompletionId, [taskId]: completionId } })),
}));

export function resetReportUi(): void {
  useReportUi.setState({
    embeds: EMPTY_EMBEDS,
    lastCompletionId: {},
    slash: null,
  });
}
