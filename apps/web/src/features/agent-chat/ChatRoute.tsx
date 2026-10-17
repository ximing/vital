import type { FC } from 'react';
import { useLocation } from 'react-router';
import { t } from '@/copy';
import { useTaskQuery } from '@/features/todos/queries';
import { contextTaskId } from './context';

/** Canvas behind the chat rail. The question itself lives in the rail. */
export const ChatRoute: FC = function ChatRoute() {
  const location = useLocation();
  const taskId = contextTaskId(location.search, null);
  const task = useTaskQuery(taskId);
  const title = task.data?.title;
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="max-w-md text-center text-[length:var(--text-meta)] text-muted">
        {title ? t.agentChat.followup.replace('{title}', title) : t.agentChat.followupBare}
      </p>
    </div>
  );
};
