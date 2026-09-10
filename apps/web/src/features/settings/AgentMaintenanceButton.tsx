import { useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';

export function AgentMaintenanceButton({ kind }: { kind: 'threads' | 'memory' }) {
  const queries = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => kind === 'threads' ? client.organizeAgentTasks() : client.distillAgentMemory(),
    onSuccess: () => { void queries.invalidateQueries({ queryKey: ['settings', 'agent-executions'] }); },
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}
        className="inline-flex h-7 items-center rounded-full border border-border px-3 text-[length:var(--text-meta)] text-muted hover:bg-surface-muted disabled:opacity-50">
        {mutation.isPending ? '正在提交…' : kind === 'threads' ? '整理线程' : '更新记忆'}
      </button>
      {mutation.isSuccess && <span role="status" className="text-[length:var(--text-caption)] text-muted">
        {mutation.data.status === 'queued' ? '已加入队列，可在系统行为中查看进度' : 'Agent 当前未启用'}
      </span>}
      {mutation.isError && <span role="alert" className="text-[length:var(--text-caption)] text-muted">提交失败，请稍后重试</span>}
    </div>
  );
}
