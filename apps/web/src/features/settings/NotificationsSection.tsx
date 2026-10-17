import { bindServices, useService } from '@rabjs/react';
import { useEffect, useState, type FC } from 'react';
import { isDesktopHost } from '@/host';
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
  const desktop = isDesktopHost();
  const localTitle = desktop ? copy.desktop : copy.browser;
  const localHint = desktop ? copy.desktopHint : copy.browserHint;
  const localAsk = desktop ? copy.desktopAsk : copy.browserAsk;
  const localDenied = desktop ? copy.desktopDenied : copy.browserDenied;
  const localUnsupported = desktop ? copy.desktopUnsupported : copy.browserUnsupported;
  const prefs = page.prefs;
  const meow = page.meow;
  const [capDraft, setCapDraft] = useState(String(prefs.scheduleDayCapMinutes));
  const [capSeen, setCapSeen] = useState(prefs.scheduleDayCapMinutes);
  if (prefs.scheduleDayCapMinutes !== capSeen) {
    setCapSeen(prefs.scheduleDayCapMinutes);
    setCapDraft(String(prefs.scheduleDayCapMinutes));
  }
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
                    title: copy.previewTitle,
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
          checked={prefs.morningBrief}
          onChange={(e) => void page.savePrefs({ ...prefs, morningBrief: e.target.checked })}
        />
        {copy.morningBrief}
      </label>
      <TimeField
        className="mt-2 max-w-xs"
        label={copy.morningBriefTime}
        value={prefs.morningBriefTime}
        disabled={!prefs.morningBrief}
        onChange={(value) => {
          if (value === '') return;
          void page.savePrefs({ ...prefs, morningBriefTime: value });
        }}
      />
      <label className="mt-4 flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.meetingPrep}
          onChange={(e) => void page.savePrefs({ ...prefs, meetingPrep: e.target.checked })}
        />
        {copy.meetingPrep}
      </label>
      <label className="mt-4 flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.weeklyObserve}
          onChange={(e) => void page.savePrefs({ ...prefs, weeklyObserve: e.target.checked })}
        />
        {copy.weeklyObserve}
      </label>
      <label className="mt-4 flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.agentErrand}
          onChange={(e) => void page.savePrefs({ ...prefs, agentErrand: e.target.checked })}
        />
        {copy.agentErrand}
      </label>
      <label className="mt-4 flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={prefs.scheduleSuggest}
          onChange={(e) => void page.savePrefs({ ...prefs, scheduleSuggest: e.target.checked })}
        />
        {copy.scheduleSuggest}
      </label>
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {copy.scheduleSuggestHint}
      </p>
      <div className="mt-3 grid max-w-lg grid-cols-2 gap-3">
        <TimeField
          label={copy.workHoursStart}
          value={prefs.workHoursStart}
          onChange={(value) => {
            if (value === '' || value >= prefs.workHoursEnd) return;
            void page.savePrefs({ ...prefs, workHoursStart: value });
          }}
        />
        <TimeField
          label={copy.workHoursEnd}
          value={prefs.workHoursEnd}
          onChange={(value) => {
            if (value === '' || value <= prefs.workHoursStart) return;
            void page.savePrefs({ ...prefs, workHoursEnd: value });
          }}
        />
      </div>
      <Field
        className="mt-3 max-w-xs"
        label={copy.scheduleDayCap}
        inputMode="numeric"
        value={capDraft}
        onChange={(e) => setCapDraft(e.target.value)}
        onBlur={() => {
          const next = Number(capDraft.trim());
          if (!Number.isInteger(next) || next < 30 || next > 1440) {
            setCapDraft(String(prefs.scheduleDayCapMinutes));
            return;
          }
          if (next === prefs.scheduleDayCapMinutes) return;
          void page.savePrefs({ ...prefs, scheduleDayCapMinutes: next });
        }}
      />
      <label className="mt-4 flex min-h-[var(--touch-min)] items-center gap-2 text-fg">
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
