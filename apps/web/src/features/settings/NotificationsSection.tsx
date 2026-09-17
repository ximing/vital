import { bindServices, useService } from '@rabjs/react';
import { useEffect, type FC } from 'react';
import { isTauriRuntime } from '@/api/client';
import { t } from '@/copy';
import { BrowserNotifyService } from '@/features/notify/browser-notify.service';
import { Banner } from '@/ui/banner';
import { TimeField } from '@/ui/time-field';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { NotificationsSectionService } from './notifications.service';

function NotificationsSectionContent({ heading = true }: { heading?: boolean }) {
  const page = useService(NotificationsSectionService);
  const browser = useService(BrowserNotifyService);
  const copy = t.settings.notify;
  const desktop = isTauriRuntime();
  const localTitle = desktop ? copy.desktop : copy.browser;
  const localHint = desktop ? copy.desktopHint : copy.browserHint;
  const localAsk = desktop ? copy.desktopAsk : copy.browserAsk;
  const localDenied = desktop ? copy.desktopDenied : copy.browserDenied;
  const localUnsupported = desktop ? copy.desktopUnsupported : copy.browserUnsupported;
  const prefs = page.prefs;
  const meow = page.meow;
  const saving = page.$model.saveChannel.loading;
  const testing = page.$model.sendTest.loading;

  useEffect(() => {
    void page.load();
    browser.refreshPermission();
  }, [page, browser]);

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

      <div className="mb-6 rounded-xl bg-surface-muted px-4 py-3">
        <p className="text-[length:var(--text-meta)] font-medium leading-[var(--text-meta-lh)] text-fg">
          {localTitle}
        </p>
        <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {localHint}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {browser.permission === 'unsupported' ? (
            <p className="text-[length:var(--text-caption)] text-muted">{localUnsupported}</p>
          ) : browser.permission === 'granted' ? (
            <p className="text-[length:var(--text-caption)] text-done">{copy.browserOn}</p>
          ) : browser.permission === 'denied' ? (
            <p className="text-[length:var(--text-caption)] text-danger">{localDenied}</p>
          ) : (
            <Button variant="ghost" onClick={() => void browser.requestPermission()}>
              {localAsk}
            </Button>
          )}
        </div>
        {desktop ? (
          <div className="mt-4 border-t border-border pt-3">
            <label className="flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
              <input
                type="checkbox"
                checked={browser.stickyEnabled}
                onChange={(e) => browser.setStickyEnabled(e.target.checked)}
              />
              {copy.sticky}
            </label>
            <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              {copy.stickyHint}
            </p>
            {browser.stickyEnabled ? (
              <Button
                className="mt-3"
                variant="ghost"
                onClick={() =>
                  browser.showPush({
                    type: 'notify',
                    id: `preview:${Date.now()}`,
                    title: copy.remindTitle,
                    body: copy.previewBody,
                    url: '/today',
                  })
                }
              >
                {copy.preview}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

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
          checked={prefs.dayRemind}
          onChange={(e) => void page.savePrefs({ ...prefs, dayRemind: e.target.checked })}
        />
        {copy.dayRemind}
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
        <Button
          variant="ghost"
          onClick={() => void page.sendTest()}
          loading={testing}
          disabled={!meow}
        >
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
