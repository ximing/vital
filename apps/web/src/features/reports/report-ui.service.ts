import { resolve, Service } from '@rabjs/react';
import type { ReportEmbeds } from '@vital/dto';
import { EMPTY_EMBEDS, type SlashQuery } from './model';

export class ReportUiService extends Service {
  embeds: ReportEmbeds = EMPTY_EMBEDS;
  lastCompletionId: Record<string, string> = {};
  slash: SlashQuery | null = null;

  setEmbeds(embeds: ReportEmbeds): void {
    this.embeds = embeds;
  }

  mergeEmbeds(embeds: ReportEmbeds): void {
    this.embeds = {
      tasks: { ...this.embeds.tasks, ...embeds.tasks },
      inbox: { ...this.embeds.inbox, ...embeds.inbox },
    };
  }

  setSlash(slash: SlashQuery | null): void {
    this.slash = slash;
  }

  setCompletionId(taskId: string, completionId: string): void {
    this.lastCompletionId = { ...this.lastCompletionId, [taskId]: completionId };
  }

  reset(): void {
    this.embeds = EMPTY_EMBEDS;
    this.lastCompletionId = {};
    this.slash = null;
  }
}

export function reportUi(): ReportUiService {
  return resolve(ReportUiService);
}

export function resetReportUi(): void {
  reportUi().reset();
}
