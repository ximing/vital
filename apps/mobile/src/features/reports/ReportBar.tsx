import { copy } from '../../lib/copy';
import { ActionBar } from '../../components/ActionBar';
import { Button } from '../../components/Button';
import { clockTime } from './period-label';

/**
 * 复盘保存 bar：共享 ActionBar（inline 随流，配合 KeyboardAvoidingView）+ 共享 Button 组合。
 * 左侧为保存状态文案（reportBarStatus），右侧 quiet 填充 / ghost 生成（仅日报）/ primary 保存。
 */
export type ReportBarState = {
  saveState: 'idle' | 'saving' | 'saved';
  dirty: boolean;
  lastSavedAt: number | null;
  busy: boolean;
  conflict: boolean;
  type: string | null;
};

export function reportBarStatus(state: ReportBarState | null): string {
  if (state === null) return '';
  if (state.saveState === 'saving') return copy.reports.saving;
  if (state.dirty) return copy.reports.unsaved;
  if (state.saveState === 'saved' && state.lastSavedAt !== null) {
    return copy.reports.savedAt.replace('{time}', clockTime(state.lastSavedAt));
  }
  return '';
}

export function ReportActionBar({
  state,
  onFill,
  onGenerate,
  onSave,
}: {
  state: ReportBarState | null;
  onFill: () => void;
  onGenerate: () => void;
  onSave: () => void;
}) {
  const busy = state?.busy ?? false;
  return (
    <ActionBar inline status={reportBarStatus(state)}>
      <Button variant="quiet" loading={busy} onPress={onFill}>
        {copy.actions.fill}
      </Button>
      {state?.type === 'daily' ? (
        <Button variant="ghost" loading={busy} onPress={onGenerate}>
          {busy ? copy.reports.generating : copy.reports.generate}
        </Button>
      ) : null}
      <Button
        disabled={state === null || !state.dirty}
        loading={state?.saveState === 'saving'}
        onPress={onSave}
      >
        {copy.actions.save}
      </Button>
    </ActionBar>
  );
}
