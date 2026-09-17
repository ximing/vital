import {
  COVER_PRESETS,
  IMAGE_MIME_TYPES,
  type CoverPreset,
  type CreateDayInput,
  type Day,
  type DayReminderOffset,
  type PatchDayInput,
} from '@vital/dto';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useId, useRef, type InputHTMLAttributes } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { DateField } from '@/ui/date-field';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { Overlay } from '@/ui/overlay';
import { TimeField } from '@/ui/time-field';
import { CoverImage } from './CoverImage';
import { draftCoverMeta } from './headline';
import { dayKeys } from './query-keys';

const OFFSETS: { value: DayReminderOffset; label: string }[] = [
  { value: 0, label: t.days.reminderOnDay },
  { value: 1, label: t.days.reminder1 },
  { value: 3, label: t.days.reminder3 },
  { value: 7, label: t.days.reminder7 },
  { value: 30, label: t.days.reminder30 },
];

const LABEL_CLASS =
  'mb-1.5 block text-[length:var(--text-caption)] font-semibold leading-[var(--text-caption-lh)] text-muted';

export type DayDraft = {
  name: string;
  note: string;
  calendar: 'solar' | 'lunar';
  anchorYmd: string;
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  lunarLeap: boolean;
  repeat: 'none' | 'yearly';
  displayMode: 'auto' | 'countdown' | 'countup';
  timeHm: string;
  coverPreset: CoverPreset;
  coverAttachmentId: string | null;
  coverUrl: string;
  reminderOffsets: DayReminderOffset[];
  pinned: boolean;
};

export function emptyDraft(today: string): DayDraft {
  const year = Number(today.slice(0, 4));
  return {
    name: '',
    note: '',
    calendar: 'solar',
    anchorYmd: today,
    lunarYear: year,
    lunarMonth: 1,
    lunarDay: 1,
    lunarLeap: false,
    repeat: 'none',
    displayMode: 'auto',
    timeHm: '',
    coverPreset: 'mist',
    coverAttachmentId: null,
    coverUrl: `/days/mist.jpg`,
    reminderOffsets: [],
    pinned: false,
  };
}

export function draftFromDay(day: Day): DayDraft {
  return {
    name: day.name,
    note: day.note,
    calendar: day.calendar,
    anchorYmd: day.anchorYmd,
    lunarYear: Number(day.anchorYmd.slice(0, 4)),
    lunarMonth: day.lunarMonth ?? 1,
    lunarDay: day.lunarDay ?? 1,
    lunarLeap: day.lunarLeap,
    repeat: day.repeat,
    displayMode: day.displayMode,
    timeHm: day.timeHm ?? '',
    coverPreset: day.coverPreset,
    coverAttachmentId: day.coverAttachmentId,
    coverUrl: day.coverUrl,
    reminderOffsets: day.reminderOffsets,
    pinned: day.pinned,
  };
}

export function draftToCreate(draft: DayDraft): CreateDayInput {
  const base = {
    name: draft.name.trim(),
    note: draft.note.trim() || undefined,
    calendar: draft.calendar,
    repeat: draft.repeat,
    displayMode: draft.displayMode,
    timeHm: draft.timeHm === '' ? null : draft.timeHm,
    coverPreset: draft.coverPreset,
    coverAttachmentId: draft.coverAttachmentId,
    reminderOffsets: draft.reminderOffsets,
    pinned: draft.pinned,
  };
  if (draft.calendar === 'lunar') {
    return {
      ...base,
      lunarYear: draft.lunarYear,
      lunarMonth: draft.lunarMonth,
      lunarDay: draft.lunarDay,
      lunarLeap: draft.lunarLeap,
    };
  }
  return { ...base, anchorYmd: draft.anchorYmd };
}

export function draftToPatch(draft: DayDraft): PatchDayInput {
  return {
    name: draft.name.trim(),
    note: draft.note.trim(),
    calendar: draft.calendar,
    repeat: draft.repeat,
    displayMode: draft.displayMode,
    timeHm: draft.timeHm === '' ? null : draft.timeHm,
    coverPreset: draft.coverPreset,
    coverAttachmentId: draft.coverAttachmentId,
    reminderOffsets: draft.reminderOffsets,
    pinned: draft.pinned,
    ...(draft.calendar === 'lunar'
      ? {
          lunarYear: draft.lunarYear,
          lunarMonth: draft.lunarMonth,
          lunarDay: draft.lunarDay,
          lunarLeap: draft.lunarLeap,
        }
      : { anchorYmd: draft.anchorYmd }),
  };
}

export function DayEditor({
  title,
  draft,
  zone,
  weekStartsOn,
  saving,
  error,
  canDelete,
  onChange,
  onSave,
  onClose,
  onDelete,
  onHide,
}: {
  title: string;
  draft: DayDraft;
  zone: string;
  weekStartsOn: 0 | 1;
  saving: boolean;
  error: string | null;
  canDelete: boolean;
  onChange: (next: DayDraft) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
  onHide?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = useQuery({
    queryKey: dayKeys.meta(draft.lunarYear),
    queryFn: () => client.getDayCalendarMeta(draft.lunarYear),
    enabled: draft.calendar === 'lunar',
  });
  const leapMonth = meta.data?.leapMonth ?? null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
  const coverTitle = draft.name.trim() === '' ? t.days.untitled : draft.name.trim();
  const customCover = draft.coverAttachmentId !== null;

  async function onUpload(file: File) {
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return;
    try {
      const uploaded = await client.upload({ file, mime: file.type, size: file.size });
      onChange({
        ...draft,
        coverAttachmentId: uploaded.id,
        coverUrl: URL.createObjectURL(file),
      });
    } catch {
      onChange({ ...draft, coverAttachmentId: draft.coverAttachmentId });
    }
  }

  function toggleOffset(value: DayReminderOffset) {
    const has = draft.reminderOffsets.includes(value);
    onChange({
      ...draft,
      reminderOffsets: has
        ? draft.reminderOffsets.filter((item) => item !== value)
        : [...draft.reminderOffsets, value].sort((a, b) => a - b),
    });
  }

  function pickPreset(preset: CoverPreset) {
    onChange({
      ...draft,
      coverPreset: preset,
      coverAttachmentId: null,
      coverUrl: `/days/${preset}.jpg`,
    });
  }

  return (
    <Overlay tone="scrim" align="center" className="p-4" onClose={onClose} closeOnEscape closeOnBackdrop>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="day-editor"
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl bg-elevated shadow-[var(--shadow)]"
      >
        <div className="relative h-[148px] shrink-0 overflow-hidden">
          <CoverImage
            src={draft.coverUrl}
            preset={draft.coverPreset}
            alt=""
            className="absolute inset-0 h-full w-full"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 to-transparent to-[60%]" />
          <div className="absolute right-4 bottom-3.5 left-6 flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1 text-white">
              <p
                data-testid="day-editor-cover-title"
                className="truncate font-display text-[18px] font-semibold"
              >
                {coverTitle}
              </p>
              <p className="mt-0.5 truncate text-[length:var(--text-caption)] tabular-nums opacity-85">
                {draftCoverMeta(draft, today)}
              </p>
            </div>
            <div className="flex max-w-[50%] shrink-0 flex-nowrap justify-end gap-1.5 overflow-x-auto">
              {COVER_PRESETS.map((preset) => {
                const selected = !customCover && draft.coverPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-label={t.days.coverPresets[preset]}
                    aria-pressed={selected}
                    onClick={() => pickPreset(preset)}
                    className={`size-[26px] shrink-0 overflow-hidden rounded-[8px] border-2 ${
                      selected
                        ? 'border-white shadow-[0_0_0_2px_var(--accent-primary)]'
                        : 'border-white/70'
                    }`}
                  >
                    <img src={`/days/${preset}.jpg`} alt="" className="size-full object-cover" />
                  </button>
                );
              })}
              <button
                type="button"
                aria-label={t.days.uploadCover}
                aria-pressed={customCover}
                onClick={() => fileRef.current?.click()}
                className={`grid size-[26px] shrink-0 place-items-center rounded-[8px] border-2 bg-black/40 text-white ${
                  customCover
                    ? 'border-white shadow-[0_0_0_2px_var(--accent-primary)]'
                    : 'border-white/70'
                }`}
              >
                <Icon icon={Plus} size={14} />
              </button>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void onUpload(file);
            }}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {error ? <Banner>{error}</Banner> : null}

          <EditorField
            label={t.days.name}
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
          <EditorField
            label={t.days.note}
            value={draft.note}
            onChange={(event) => onChange({ ...draft, note: event.target.value })}
          />

          <div>
            <p className={LABEL_CLASS}>{t.days.calendar}</p>
            <Seg
              ariaLabel={t.days.calendar}
              value={draft.calendar}
              onChange={(calendar) => onChange({ ...draft, calendar })}
              options={[
                { value: 'solar', label: t.days.solar },
                { value: 'lunar', label: t.days.lunar },
              ]}
            />
          </div>

          {draft.calendar === 'solar' ? (
            <div>
              <p className={LABEL_CLASS}>{t.days.date}</p>
              <DateField
                value={draft.anchorYmd}
                kind="date"
                zone={zone}
                weekStartsOn={weekStartsOn}
                ariaLabel={t.days.date}
                onChange={(anchorYmd) => onChange({ ...draft, anchorYmd: anchorYmd.slice(0, 10) })}
              />
            </div>
          ) : (
            <div>
              <p className={LABEL_CLASS}>{t.days.date}</p>
              <div className="grid grid-cols-3 gap-2">
                <EditorField
                  label={t.days.lunarYear}
                  inputMode="numeric"
                  value={String(draft.lunarYear)}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      lunarYear:
                        Number(event.target.value.replaceAll(/[^0-9]/g, '').slice(0, 4)) ||
                        draft.lunarYear,
                    })
                  }
                />
                <EditorField
                  label={t.days.lunarMonth}
                  inputMode="numeric"
                  value={String(draft.lunarMonth)}
                  onChange={(event) => {
                    const n = Number(event.target.value.replaceAll(/[^0-9]/g, ''));
                    onChange({ ...draft, lunarMonth: Math.min(12, Math.max(1, n || 1)) });
                  }}
                />
                <EditorField
                  label={t.days.lunarDay}
                  inputMode="numeric"
                  value={String(draft.lunarDay)}
                  onChange={(event) => {
                    const n = Number(event.target.value.replaceAll(/[^0-9]/g, ''));
                    onChange({ ...draft, lunarDay: Math.min(30, Math.max(1, n || 1)) });
                  }}
                />
              </div>
              {leapMonth === draft.lunarMonth ? (
                <label className="mt-1 flex min-h-[var(--touch-min)] items-center gap-2 text-[length:var(--text-meta)]">
                  <input
                    type="checkbox"
                    checked={draft.lunarLeap}
                    onChange={(event) => onChange({ ...draft, lunarLeap: event.target.checked })}
                  />
                  {t.days.lunarLeap}
                </label>
              ) : null}
            </div>
          )}

          <div>
            <p className={LABEL_CLASS}>{t.days.repeat}</p>
            <Seg
              ariaLabel={t.days.repeat}
              value={draft.repeat}
              onChange={(repeat) => onChange({ ...draft, repeat })}
              options={[
                { value: 'none', label: t.days.repeatNone },
                { value: 'yearly', label: t.days.repeatYearly },
              ]}
            />
          </div>

          <div>
            <p className={LABEL_CLASS}>{t.days.display}</p>
            <Seg
              ariaLabel={t.days.display}
              value={draft.displayMode}
              onChange={(displayMode) => onChange({ ...draft, displayMode })}
              options={[
                { value: 'auto', label: t.days.displayAuto },
                { value: 'countdown', label: t.days.displayCountdown },
                { value: 'countup', label: t.days.displayCountup },
              ]}
            />
          </div>

          <div className="[&>p]:mb-1.5 [&>p]:text-[length:var(--text-caption)] [&>p]:font-semibold [&>p]:leading-[var(--text-caption-lh)] [&>p]:text-muted">
            <TimeField
              label={t.days.time}
              value={draft.timeHm}
              onChange={(timeHm) => onChange({ ...draft, timeHm })}
              clearable
            />
          </div>

          <fieldset>
            <legend className="text-[length:var(--text-caption)] font-semibold text-muted">
              {t.days.reminder}
            </legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {OFFSETS.map((item) => {
                const on = draft.reminderOffsets.includes(item.value);
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleOffset(item.value)}
                    className={`inline-flex h-[30px] items-center rounded-full px-3 text-[length:var(--text-caption)] ${
                      on
                        ? 'border border-transparent bg-accent-subtle font-semibold text-accent-deep'
                        : 'border border-border bg-surface text-muted'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex items-center gap-2.5 py-0.5">
            <span className="flex-1 text-[length:var(--text-body)]">{t.days.pinFront}</span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.pinned}
              aria-label={t.days.pinFront}
              onClick={() => onChange({ ...draft, pinned: !draft.pinned })}
              className={`relative h-[22px] w-9 shrink-0 rounded-full transition-colors duration-[var(--ease-out)] ${
                draft.pinned ? 'bg-accent' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`absolute top-[3px] size-4 rounded-full bg-elevated shadow-[var(--shadow-xs)] transition-[left] duration-[var(--ease-out)] ${
                  draft.pinned ? 'left-[17px]' : 'left-[3px]'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-6 py-3.5">
          {canDelete && onDelete ? (
            <Button
              variant="quiet"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              onClick={onDelete}
            >
              {t.days.delete}
            </Button>
          ) : onHide ? (
            <Button
              variant="quiet"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              onClick={onHide}
            >
              {t.days.hide}
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button variant="quiet" className="border border-border text-fg" onClick={onClose}>
              {t.days.cancel}
            </Button>
            <Button variant="primary" loading={saving} disabled={draft.name.trim() === ''} onClick={onSave}>
              {t.days.save}
            </Button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function EditorField({
  label,
  className = '',
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className={LABEL_CLASS}>
        {label}
      </label>
      <input id={fieldId} className={`${FIELD_CONTROL_CLASS} w-full`} {...props} />
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex gap-0.5 rounded-md bg-surface-muted p-[3px]"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={`inline-flex h-7 items-center rounded-[7px] px-3 text-[13px] ${
              on ? 'bg-elevated font-semibold text-fg shadow-[var(--shadow-xs)]' : 'text-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
