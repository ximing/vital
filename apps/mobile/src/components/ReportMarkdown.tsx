import type { ReportEmbeds, TaskStatus } from '@vital/dto';
import { MarkdownDoc } from './MarkdownDoc';

export function ReportMarkdown({
  bodyMd,
  embeds,
  onToggleTask,
  onOpenInbox,
}: {
  bodyMd: string;
  embeds: ReportEmbeds;
  onToggleTask?: (id: string, status: TaskStatus) => void;
  onOpenInbox?: (id: string) => void;
}) {
  return (
    <MarkdownDoc
      markdown={bodyMd}
      embeds={embeds}
      onToggleTask={onToggleTask}
      onOpenInbox={onOpenInbox}
    />
  );
}
