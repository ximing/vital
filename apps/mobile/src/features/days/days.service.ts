import { Service } from '@rabjs/react';
import type {
  CoverPreset,
  CreateDayInput,
  Day,
  DayCatalogItem,
  DayReminderOffset,
  PatchDayInput,
} from '@vital/dto';
import { COVER_PRESETS, IMAGE_MIME_TYPES } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { localDateStamp } from '../../lib/format';
import { AuthService } from '../../services/auth.service';

export type DayDraft = {
  id: string | null;
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
  coverPreset: CoverPreset;
  coverAttachmentId: string | null;
  reminderOffsets: DayReminderOffset[];
  pinned: boolean;
};

export function emptyDayDraft(today: string): DayDraft {
  return {
    id: null,
    name: '',
    note: '',
    calendar: 'solar',
    anchorYmd: today,
    lunarYear: Number(today.slice(0, 4)),
    lunarMonth: 1,
    lunarDay: 1,
    lunarLeap: false,
    repeat: 'none',
    displayMode: 'auto',
    coverPreset: 'mist',
    coverAttachmentId: null,
    reminderOffsets: [],
    pinned: false,
  };
}

export function draftFromDay(day: Day): DayDraft {
  return {
    id: day.id,
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
    coverPreset: day.coverPreset,
    coverAttachmentId: day.coverAttachmentId,
    reminderOffsets: day.reminderOffsets,
    pinned: day.pinned,
  };
}

function toCreate(draft: DayDraft): CreateDayInput {
  const base = {
    name: draft.name.trim(),
    note: draft.note.trim() || undefined,
    calendar: draft.calendar,
    repeat: draft.repeat,
    displayMode: draft.displayMode,
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

function toPatch(draft: DayDraft): PatchDayInput {
  return {
    name: draft.name.trim(),
    note: draft.note.trim(),
    calendar: draft.calendar,
    repeat: draft.repeat,
    displayMode: draft.displayMode,
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

export class DaysService extends Service {
  items: Day[] = [];
  catalog: DayCatalogItem[] = [];
  loading = true;
  error: string | null = null;
  draft: DayDraft | null = null;
  formError: string | null = null;
  saving = false;
  catalogOpen = false;
  editing: Day | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get zone(): string {
    return this.auth.user?.timezone ?? 'Asia/Shanghai';
  }

  get today(): string {
    return localDateStamp(this.zone);
  }

  get presets(): readonly CoverPreset[] {
    return COVER_PRESETS;
  }

  async load(): Promise<void> {
    this.loading = this.items.length === 0;
    try {
      const res = await client.listDays();
      this.items = res.items;
      this.error = null;
    } catch (err) {
      this.error = humanError(err);
    } finally {
      this.loading = false;
    }
  }

  async loadCatalog(): Promise<void> {
    try {
      const res = await client.listDayCatalog();
      this.catalog = res.items;
    } catch (err) {
      toast(humanError(err));
    }
  }

  openCreate(): void {
    this.formError = null;
    this.editing = null;
    this.draft = emptyDayDraft(this.today);
  }

  openEdit(day: Day): void {
    this.formError = null;
    this.editing = day;
    this.draft = draftFromDay(day);
  }

  closeDraft(): void {
    this.draft = null;
    this.editing = null;
    this.formError = null;
  }

  patchDraft(patch: Partial<DayDraft>): void {
    if (this.draft === null) return;
    this.draft = { ...this.draft, ...patch };
  }

  openCatalog(): void {
    this.catalogOpen = true;
    void this.loadCatalog();
  }

  closeCatalog(): void {
    this.catalogOpen = false;
  }

  async saveDraft(): Promise<void> {
    if (this.draft === null || this.saving) return;
    if (this.draft.name.trim() === '') {
      this.formError = copy.days.name;
      return;
    }
    this.saving = true;
    this.formError = null;
    try {
      if (this.draft.id === null) await client.createDay(toCreate(this.draft));
      else await client.patchDay(this.draft.id, toPatch(this.draft));
      this.draft = null;
      this.editing = null;
      await this.load();
    } catch (err) {
      this.formError = humanError(err);
    } finally {
      this.saving = false;
    }
  }

  async addCatalog(key: string): Promise<void> {
    try {
      await client.createDay({ catalogKey: key });
      await Promise.all([this.load(), this.loadCatalog()]);
    } catch (err) {
      toast(humanError(err));
    }
  }

  async hide(day: Day): Promise<void> {
    try {
      await client.patchDay(day.id, { hidden: true });
      this.closeDraft();
      await this.load();
    } catch (err) {
      toast(humanError(err));
    }
  }

  async remove(day: Day): Promise<void> {
    try {
      await client.deleteDay(day.id);
      this.closeDraft();
      await this.load();
    } catch (err) {
      toast(humanError(err));
    }
  }

  async pickCover(): Promise<void> {
    if (this.draft === null) return;
    try {
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const mime = asset.mimeType ?? 'image/jpeg';
      if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return;
      const { File } = await import('expo-file-system');
      const size = asset.fileSize ?? new File(asset.uri).size;
      if (!size) return;
      const uploaded = await client.upload({ file: new File(asset.uri), mime, size });
      this.patchDraft({ coverAttachmentId: uploaded.id });
    } catch (err) {
      toast(humanError(err));
    }
  }

  toggleOffset(offset: DayReminderOffset): void {
    if (this.draft === null) return;
    const has = this.draft.reminderOffsets.includes(offset);
    this.patchDraft({
      reminderOffsets: has
        ? this.draft.reminderOffsets.filter((item) => item !== offset)
        : [...this.draft.reminderOffsets, offset].sort((a, b) => a - b),
    });
  }
}
