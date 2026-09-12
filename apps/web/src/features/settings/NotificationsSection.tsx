import { bindServices, useService } from '@rabjs/react';
import { useEffect, type FC } from 'react';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { TimeField } from '@/ui/time-field';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { NotificationsSectionService } from './notifications.service';

function NotificationsSectionContent({ heading = true }: { heading?: boolean }) {
  const page = useService(NotificationsSectionService);
  const copy = t.settings.notify;
  const prefs = page.prefs;
  const meow = page.meow;
  const saving = page.$model.saveChannel.loading;
  const testing = page.$model.sendTest.loading;

  useEffect(() => {
    void page.load();
  }, [page]);

  return (
    <section className={heading ? 'mt-8' : undefined}>
      {heading ? (
        <>
          <h2 className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {copy.title}
          </h2>
          <p className="mt-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {copy.hint}
          </p>
        </>
      ) : null}

      <label className="flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.agentInsights}
          onChange={(e) => void page.savePrefs({ ...prefs, agentInsights: e.target.checked })}
        />
        {copy.agentInsights}
      </label>
      <label className="flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.taskRemind}
          onChange={(e) => void page.savePrefs({ ...prefs, taskRemind: e.target.checked })}
        />
        {copy.taskRemind}
      </label>
      <label className="flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.taskDue}
          onChange={(e) => void page.savePrefs({ ...prefs, taskDue: e.target.checked })}
        />
        {copy.taskDue}
      </label>

      <TimeField
        className="mt-4 max-w-xs"
        label={copy.allDayTime}
        value={prefs.allDayNotifyTime}
        onChange={(value) => {
          if (value === '') return;
          void page.savePrefs({ ...prefs, allDayNotifyTime: value });
        }}
      />

      <div className="mt-4 grid max-w-lg grid-cols-2 gap-3">
        <TimeField
          label={copy.quietStart}
          value={prefs.quietHoursStart ?? ''}
          clearable
          onChange={(start) => {
            const nextStart = start === '' ? null : start;
            const end = nextStart === null ? null : (prefs.quietHoursEnd ?? '08:00');
            void page.savePrefs({ ...prefs, quietHoursStart: nextStart, quietHoursEnd: end });
          }}
        />
        <TimeField
          label={copy.quietEnd}
          value={prefs.quietHoursEnd ?? ''}
          disabled={prefs.quietHoursStart === null}
          clearable
          onChange={(end) => {
            const nextEnd = end === '' ? null : end;
            const start = nextEnd === null ? null : prefs.quietHoursStart;
            void page.savePrefs({ ...prefs, quietHoursStart: start, quietHoursEnd: nextEnd });
          }}
        />
      </div>

      <h3 className="mt-8 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {copy.channels}
      </h3>
      <Field
        className="mt-3"
        label={copy.nickname}
        value={page.nickname}
        onChange={(e) => page.setNickname(e.target.value)}
        autoComplete="off"
      />
      <label className="mt-2 flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={page.enabled}
          onChange={(e) => page.setEnabled(e.target.checked)}
        />
        {copy.enabled}
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => void page.saveChannel()}
          loading={saving}
          disabled={page.nickname.trim() === ''}
        >
          {copy.saveChannel}
        </Button>
        <Button variant="ghost" onClick={() => void page.sendTest()} loading={testing} disabled={!meow}>
          {testing ? copy.testing : copy.test}
        </Button>
      </div>
      {meow?.lastError ? (
        <p className="mt-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-danger">
          {copy.lastError}：{meow.lastError}
        </p>
      ) : null}
      {page.error ? <Banner>{page.error}</Banner> : null}
      {page.notice ? (
        <p className="mt-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {page.notice}
        </p>
      ) : null}
    </section>
  );
}

export const NotificationsSection: FC<{ heading?: boolean }> = bindServices(
  NotificationsSectionContent,
  [NotificationsSectionService],
);
