import type { Day, DayCatalogKind } from '@vital/dto';
import { useService } from '@rabjs/react';
import { Bell } from 'lucide-react';
import { useMemo, useState, type FC } from 'react';
import { useSearchParams } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { EmptyArt } from '@/ui/empty-art';
import { Overlay } from '@/ui/overlay';
import { CoverImage } from './CoverImage';
import {
  DayEditor,
  draftFromDay,
  draftToCreate,
  draftToPatch,
  emptyDraft,
  type DayDraft,
} from './DayEditor';
import { DaysTimeline } from './DaysTimeline';
import {
  holidayChipText,
  matchesFilter,
  pickNextUp,
  reminderChipText,
  shortYmd,
  yearsText,
  type DayFilter,
} from './headline';
import { useDayCatalogQuery, useDayMutations, useDaysQuery } from './queries';
import { buildHeroTrack } from './timeline';

const FILTERS: { id: DayFilter; label: string }[] = [
  { id: 'all', label: t.days.filterAll },
  { id: 'countdown', label: t.days.filterCountdown },
  { id: 'countup', label: t.days.filterCountup },
  { id: 'festival', label: t.days.filterFestival },
];

const EMPTY_DAYS: Day[] = [];

function PinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16 3a1 1 0 0 0-.8.4l-2.4 3.2-4.6 1.1a1 1 0 0 0-.5 1.7l3.2 3.2-4.4 5.1a1 1 0 1 0 1.5 1.3l4.4-5.1 3.2 3.2a1 1 0 0 0 1.7-.5l1.1-4.6 3.2-2.4A1 1 0 0 0 22 8.6l-5.2-5.2A1 1 0 0 0 16 3Z" />
    </svg>
  );
}

function NextUpHero({
  day,
  todayYmd,
  onOpen,
}: {
  day: Day;
  todayYmd: string;
  onOpen: () => void;
}) {
  const holiday = day.holidayRange
    ? holidayChipText(day.holidayRange.from, day.holidayRange.to, todayYmd)
    : null;
  const reminder = reminderChipText(day.reminderOffsets);
  const track = day.nextYmd ? buildHeroTrack(todayYmd, day.nextYmd, day.holidayRange) : null;
  const meta = [day.solarLabel, day.lunarLabel].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      data-testid="days-hero"
      onClick={onOpen}
      className="relative mt-6 grid w-full overflow-hidden rounded-xl bg-elevated text-left shadow-[var(--shadow)] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-accent max-lg:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="relative min-w-0 px-8 pb-[26px] pt-7 lg:pl-9">
        <span className="eyebrow eyebrow-accent">{t.days.nextUp}</span>
        <div className="mt-3.5 flex items-baseline gap-2.5">
          <span className="font-display text-[88px] font-bold leading-[0.95] tracking-[-0.04em] text-accent-deep tabular-nums">
            {day.headline.days}
          </span>
          <span className="text-[16px] font-semibold text-accent">{t.days.unitAfterDay}</span>
        </div>
        <p className="mt-2.5 font-display text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)]">
          {day.name}
        </p>
        {meta ? <p className="mt-1 text-[length:var(--text-meta)] text-muted tabular-nums">{meta}</p> : null}
        {holiday || reminder ? (
          <div className="mt-3.5 flex flex-wrap gap-2">
            {holiday ? (
              <span className="inline-flex h-[26px] items-center rounded-full bg-[var(--amber-100)] px-2.5 text-[12px] font-medium text-due">
                {holiday}
              </span>
            ) : null}
            {reminder ? (
              <span className="inline-flex h-[26px] items-center gap-1 rounded-full bg-surface-muted px-2.5 text-[12px] font-medium text-muted">
                <Bell className="size-3" strokeWidth={1.75} aria-hidden />
                {reminder}
              </span>
            ) : null}
          </div>
        ) : null}
        {track && day.nextYmd ? (
          <div className="mt-[22px]">
            <div className="relative h-1.5 rounded-[3px] bg-surface-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-[3px] bg-gradient-to-r from-accent-subtle to-accent"
                style={{ width: `${track.fillPercent}%` }}
              />
              {track.holiday ? (
                <div
                  className="absolute -inset-y-[3px] rounded-[5px] border border-dashed border-due/45 bg-due/20"
                  style={{
                    left: `${track.holiday.leftPercent}%`,
                    width: `${track.holiday.widthPercent}%`,
                  }}
                />
              ) : null}
              <span className="absolute top-1/2 left-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg" />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_3px_var(--bg-accent-subtle)]"
                style={{ left: `${track.toPercent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[12px] text-tertiary">
              <span>{t.days.todayMark.replace('{date}', todayYmd.slice(5))}</span>
              <span className="font-semibold text-accent">
                {day.name} {shortYmd(day.nextYmd, todayYmd)}
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="relative hidden min-h-[220px] lg:block lg:min-h-full">
        <CoverImage
          src={day.coverUrl}
          preset={day.coverPreset}
          alt={day.name}
          className="absolute inset-0 h-full w-full"
        />
        {day.pinned ? (
          <span className="absolute top-3.5 right-3.5 grid size-[30px] place-items-center rounded-full bg-fg/45 text-white backdrop-blur-[4px]">
            <PinMark className="size-3.5" />
          </span>
        ) : null}
      </div>
    </button>
  );
}

function TodayBand({ day, onOpen }: { day: Day; onOpen: () => void }) {
  const years = yearsText(day);
  const yearly =
    day.repeat === 'yearly'
      ? ` · ${t.days.repeatYearly}`
      : '';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-[18px] flex w-full items-center gap-4 rounded-[16px] bg-gradient-to-r from-accent-subtle to-accent-subtle/40 py-3.5 pr-5 pl-4 text-left"
    >
      <CoverImage
        src={day.coverUrl}
        preset={day.coverPreset}
        alt=""
        className="size-14 shrink-0 rounded-[12px]"
      />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[length:var(--text-section)] font-semibold">
          {day.name}
        </span>
        <span className="mt-0.5 block text-[12px] text-muted tabular-nums">
          {t.days.since.replace('{date}', day.anchorYmd)}
          {yearly}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-display text-[24px] font-bold text-accent-deep">{t.days.today}</span>
        {years ? <span className="block text-[12px] font-semibold text-accent">{years}</span> : null}
      </span>
    </button>
  );
}

function CountdownCard({
  day,
  todayYmd,
  onOpen,
}: {
  day: Day;
  todayYmd: string;
  onOpen: () => void;
}) {
  const focus = day.nextYmd ?? day.prevYmd;
  const holiday = day.holidayRange
    ? holidayChipText(day.holidayRange.from, day.holidayRange.to, todayYmd)
    : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-lg bg-elevated py-4 pr-5 pl-4 text-left shadow-[var(--shadow-xs)] transition-[box-shadow,transform] duration-[var(--ease-out)] hover:-translate-y-px hover:shadow-[var(--shadow)]"
    >
      <CoverImage
        src={day.coverUrl}
        preset={day.coverPreset}
        alt=""
        className="size-16 shrink-0 rounded-md"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14px] font-semibold">
          <span className="truncate">{day.name}</span>
          {day.pinned ? <PinMark className="size-3.5 shrink-0 text-accent" /> : null}
        </span>
        <span className="mt-[3px] block truncate text-[12px] text-tertiary tabular-nums">
          {shortYmd(focus, todayYmd)}
          {day.lunarLabel ? ` · ${day.lunarLabel}` : ''}
          {holiday ? (
            <>
              {' · '}
              <span className="font-medium text-due">{holiday}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-display text-[34px] leading-none font-bold tracking-[-0.03em] text-accent-deep tabular-nums">
          {day.headline.days}
        </span>
        <span className="mt-[3px] block text-[11px] font-semibold text-accent">{t.days.unitAfterDay}</span>
      </span>
    </button>
  );
}

function CountupRow({ day, onOpen }: { day: Day; onOpen: () => void }) {
  const years = yearsText(day);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3.5 py-[13px] pr-5 pl-4 text-left hover:bg-surface-muted"
    >
      <CoverImage
        src={day.coverUrl}
        preset={day.coverPreset}
        alt=""
        className="size-11 shrink-0 rounded-[8px]"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{day.name}</span>
        <span className="mt-px block text-[12px] text-tertiary tabular-nums">
          {t.days.since.replace('{date}', day.anchorYmd)}
        </span>
      </span>
      {years ? (
        <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-surface-muted px-2 text-[11px] font-semibold text-muted">
          {years}
        </span>
      ) : null}
      <span className="flex shrink-0 items-baseline gap-1.5">
        <span className="font-display text-[22px] font-bold tracking-[-0.02em] text-fg tabular-nums">
          {day.headline.days.toLocaleString('zh-CN')}
        </span>
        <span className="text-[11px] text-muted">{t.days.unitDay}</span>
      </span>
    </button>
  );
}

function SectionRule({ label, count }: { label: string; count: number }) {
  return (
    <div className="mt-[30px] mb-3 flex items-center gap-2.5">
      <span className="eyebrow">{label}</span>
      <span className="text-[11px] text-tertiary tabular-nums">{count}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function CatalogPanel({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const catalog = useDayCatalogQuery(true);
  const groups: { kind: DayCatalogKind; title: string }[] = [
    { kind: 'statutory', title: t.days.catalogStatutory },
    { kind: 'traditional', title: t.days.catalogTraditional },
    { kind: 'international', title: t.days.catalogInternational },
  ];
  const [busy, setBusy] = useState<string | null>(null);

  async function add(key: string) {
    setBusy(key);
    try {
      await client.createDay({ catalogKey: key });
      await onChanged();
      await catalog.refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Overlay tone="scrim" align="center" className="px-4" onClose={onClose} closeOnEscape closeOnBackdrop>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.days.catalog}
        className="max-h-[min(80vh,640px)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-elevated p-5 shadow-[var(--shadow)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[length:var(--text-section)] font-semibold">{t.days.catalog}</h2>
          <Button variant="quiet" onClick={onClose}>
            {t.days.close}
          </Button>
        </div>
        {groups.map((group) => {
          const items = (catalog.data?.items ?? []).filter((item) => item.kind === group.kind);
          if (items.length === 0) return null;
          return (
            <section key={group.kind} className="mt-5">
              <h3 className="text-[length:var(--text-meta)] text-muted">{group.title}</h3>
              <ul className="mt-2 divide-y divide-border">
                {items.map((item) => (
                  <li key={item.key} className="flex items-center justify-between py-2.5">
                    <span>{item.name}</span>
                    {item.added ? (
                      <span className="text-[length:var(--text-caption)] text-muted">{t.days.catalogAdded}</span>
                    ) : (
                      <Button
                        variant="ghost"
                        loading={busy === item.key}
                        onClick={() => void add(item.key)}
                      >
                        {item.hidden ? t.days.catalogShow : t.days.catalogAdd}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Overlay>
  );
}

function DaysWorkspaceContent() {
  const auth = useService(AuthService);
  const zone = auth.user?.timezone ?? 'Asia/Shanghai';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
  const list = useDaysQuery();
  const mutations = useDayMutations();
  const [search, setSearch] = useSearchParams();
  const [filter, setFilter] = useState<DayFilter>('all');
  const [draft, setDraft] = useState<DayDraft | null>(null);
  const [editing, setEditing] = useState<Day | 'new' | null>(null);
  const [hydratedQueryId, setHydratedQueryId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Day | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allDays = list.data ?? EMPTY_DAYS;
  const nextUp = useMemo(() => pickNextUp(allDays), [allDays]);
  const todayDays = useMemo(
    () => allDays.filter((day) => day.headline.kind === 'today'),
    [allDays],
  );
  const filtered = useMemo(
    () => allDays.filter((day) => matchesFilter(day, filter)),
    [allDays, filter],
  );
  const countdownDays = useMemo(
    () => filtered.filter((day) => day.headline.kind === 'countdown'),
    [filtered],
  );
  const countupDays = useMemo(
    () => filtered.filter((day) => day.headline.kind === 'countup'),
    [filtered],
  );

  const queryId = search.get('id');
  const queryDay = queryId ? allDays.find((day) => day.id === queryId) : undefined;
  // Deep-link ?id= opens the editor once the list is in (render-time, not an effect).
  if (queryDay && queryId !== hydratedQueryId && editing === null && draft === null) {
    setHydratedQueryId(queryId);
    setEditing(queryDay);
    setDraft(draftFromDay(queryDay));
  } else if (!queryId && hydratedQueryId !== null && editing === null) {
    setHydratedQueryId(null);
  }

  function openNew() {
    setError(null);
    setEditing('new');
    setDraft(emptyDraft(today));
    setHydratedQueryId(null);
  }

  function openDay(day: Day) {
    setError(null);
    setEditing(day);
    setDraft(draftFromDay(day));
    setHydratedQueryId(day.id);
    setSearch({ id: day.id }, { replace: true });
  }

  function closeEditor() {
    setEditing(null);
    setDraft(null);
    setError(null);
    setHydratedQueryId(search.get('id'));
    if (search.get('id')) setSearch({}, { replace: true });
  }

  async function save() {
    if (draft === null || editing === null) return;
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await client.createDay(draftToCreate(draft));
      } else {
        await client.patchDay(editing.id, draftToPatch(draft));
      }
      await mutations.invalidate();
      closeEditor();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-[1040px]">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
              {t.days.title}
            </h1>
            <p className="mt-1 max-w-xl text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
              {t.days.hint}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 gap-2 pb-0.5">
            <Button variant="ghost" onClick={() => setCatalogOpen(true)}>
              {t.days.catalog}
            </Button>
            <Button variant="primary" onClick={openNew}>
              + {t.days.add}
            </Button>
          </div>
        </div>

        {list.error ? (
          <div className="mt-6 flex items-center gap-3">
            <Banner>{humanError(list.error)}</Banner>
            <Button variant="ghost" onClick={() => void list.refetch()}>
              {t.days.retry}
            </Button>
          </div>
        ) : null}

        {list.isLoading ? (
          <p className="mt-10 text-[length:var(--text-meta)] text-muted">{t.days.loading}</p>
        ) : allDays.length === 0 ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <EmptyArt />
            <p className="font-medium">{t.days.emptyTitle}</p>
            <p className="mt-2 max-w-sm text-[length:var(--text-meta)] text-muted">{t.days.emptyHint}</p>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" onClick={openNew}>
                {t.days.add}
              </Button>
              <Button variant="ghost" onClick={() => setCatalogOpen(true)}>
                {t.days.emptyCatalog}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {nextUp ? (
              <NextUpHero day={nextUp} todayYmd={today} onOpen={() => openDay(nextUp)} />
            ) : null}

            <DaysTimeline days={allDays} todayYmd={today} onOpen={openDay} />

            <div className="mt-[26px] flex flex-wrap items-center gap-1.5">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={`inline-flex h-8 items-center rounded-full px-3.5 text-[13px] ${
                    filter === item.id
                      ? 'bg-accent-subtle font-semibold text-accent-deep'
                      : 'text-muted hover:bg-surface-muted'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              <span className="ml-auto text-[12px] text-tertiary tabular-nums">
                {t.days.totalCount.replace('{n}', String(allDays.length))}
              </span>
            </div>

            {todayDays.map((day) => (
              <TodayBand key={day.id} day={day} onOpen={() => openDay(day)} />
            ))}

            {countdownDays.length > 0 ? (
              <>
                <SectionRule label={t.days.filterCountdown} count={countdownDays.length} />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {countdownDays.map((day) => (
                    <CountdownCard
                      key={day.id}
                      day={day}
                      todayYmd={today}
                      onOpen={() => openDay(day)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {countupDays.length > 0 ? (
              <>
                <SectionRule label={t.days.filterCountup} count={countupDays.length} />
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                  {countupDays.map((day) => (
                    <CountupRow key={day.id} day={day} onOpen={() => openDay(day)} />
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>

      {draft && editing !== null ? (
        <DayEditor
          title={editing === 'new' ? t.days.creating : t.days.edit}
          draft={draft}
          zone={zone}
          weekStartsOn={weekStartsOn}
          saving={saving}
          error={error}
          canDelete={editing !== 'new' && editing.canDelete}
          onChange={setDraft}
          onSave={() => void save()}
          onClose={closeEditor}
          onDelete={
            editing !== 'new' && editing.canDelete ? () => setConfirmDelete(editing) : undefined
          }
          onHide={
            editing !== 'new' && editing.source === 'statutory'
              ? () => {
                  void mutations.patch.mutateAsync({ id: editing.id, input: { hidden: true } });
                  closeEditor();
                }
              : undefined
          }
        />
      ) : null}

      {catalogOpen ? (
        <CatalogPanel
          onClose={() => setCatalogOpen(false)}
          onChanged={() => mutations.invalidate()}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={t.days.deleteTitle}
          body={t.days.deleteBody}
          confirmLabel={t.days.delete}
          cancelLabel={t.days.cancel}
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            void mutations.remove.mutateAsync(confirmDelete.id);
            setConfirmDelete(null);
            closeEditor();
          }}
        />
      ) : null}
    </div>
  );
}

export const DaysWorkspace: FC = DaysWorkspaceContent;
