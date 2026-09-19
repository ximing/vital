import { DEFAULT_LLM_SETTINGS, DEFAULT_NOTIFICATION_PREFS, type Day, type UserProfile } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { DaysWorkspace } from '../../../src/features/days/DaysWorkspace';
import { draftCoverMeta, lunarDateLabel, pickNextUp, shortYmd } from '../../../src/features/days/headline';
import {
  assignTimelineLanes,
  buildDaysTimeline,
  clipVerticalLine,
  estimateTextWidthPx,
  TIMELINE_MAX_LANES,
  timelineTrackMetrics,
  timelineYmd,
  ymdDiffDays,
  type TimelineLabelPlacement,
} from '../../../src/features/days/timeline';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listDays: vi.fn(),
      listDayCatalog: vi.fn(),
      getDayCalendarMeta: vi.fn(),
      createDay: vi.fn(),
      patchDay: vi.fn(),
      deleteDay: vi.fn(),
    },
  };
});

const mockUser: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: {},
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

function sampleDay(over: Partial<Day> = {}): Day {
  return {
    id: 'd1',
    name: '中秋节',
    note: '',
    source: 'statutory',
    catalogKey: 'cn.mid-autumn',
    catalogKind: 'statutory',
    calendar: 'lunar',
    repeat: 'yearly',
    displayMode: 'auto',
    anchorYmd: addDays(todayYmd, 9),
    nextYmd: addDays(todayYmd, 9),
    prevYmd: '2025-10-06',
    lunarMonth: 8,
    lunarDay: 15,
    lunarLeap: false,
    lunarLabel: '农历八月十五',
    solarLabel: '2026年9月25日',
    timeHm: null,
    coverPreset: 'moon',
    coverAttachmentId: null,
    coverUrl: '/days/moon.jpg',
    reminderOffsets: [0],
    pinned: false,
    hidden: false,
    canDelete: false,
    headline: { kind: 'countdown', days: 9, years: null },
    holidayRange: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function renderDays() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/days']}>
          <Routes>
            <Route path="/days" element={<DaysWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('DaysWorkspace', () => {
  beforeEach(() => {
    setAuthForTest(mockUser);
    vi.mocked(client.getDayCalendarMeta).mockResolvedValue({ year: 2026, leapMonth: null });
    vi.mocked(client.listDays).mockResolvedValue({
      items: [
        sampleDay(),
        sampleDay({
          id: 'd2',
          name: '在一起',
          source: 'custom',
          catalogKey: null,
          catalogKind: null,
          calendar: 'solar',
          repeat: 'yearly',
          displayMode: 'countup',
          anchorYmd: '2019-06-01',
          nextYmd: '2027-06-01',
          prevYmd: '2026-06-01',
          lunarMonth: null,
          lunarDay: null,
          lunarLeap: false,
          lunarLabel: null,
          solarLabel: '2019年6月1日',
          coverPreset: 'river',
          coverUrl: '/days/river.jpg',
          reminderOffsets: [],
          headline: { kind: 'countup', days: 2664, years: 8 },
        }),
      ],
    });
  });

  it('renders countdown cards', async () => {
    renderDays();
    const hero = await screen.findByTestId('days-hero');
    expect(within(hero).getByText('中秋节')).toBeInTheDocument();
    expect(within(hero).getByText(t.days.nextUp)).toBeInTheDocument();
    expect(within(hero).getByText('9')).toBeInTheDocument();
    expect(within(hero).getByText(t.days.unitAfterDay)).toBeInTheDocument();

    const timeline = screen.getByTestId('days-timeline');
    expect(within(timeline).getByText('中秋节')).toBeInTheDocument();

    expect(screen.getAllByText(t.days.unitAfterDay).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(t.days.yearNth.replace('{n}', '8'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `+ ${t.days.add}` })).toBeInTheDocument();
  });

  it('opens the editor sheet with cover header, chips, and hide for statutory days', async () => {
    const user = userEvent.setup();
    renderDays();
    await user.click(await screen.findByTestId('days-hero'));

    const dialog = await screen.findByRole('dialog', { name: t.days.edit });
    expect(within(dialog).getByTestId('day-editor-cover-title')).toHaveTextContent('中秋节');
    expect(within(dialog).getByLabelText(t.days.name)).toHaveValue('中秋节');
    expect(within(dialog).getByLabelText(t.days.note)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: t.days.lunar })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('radio', { name: t.days.displayAuto })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('button', { name: t.days.reminderOnDay })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('switch', { name: t.days.pinFront })).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByRole('button', { name: t.days.coverPresets.moon })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: t.days.uploadCover })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t.days.hide })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: t.days.delete })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t.days.cancel })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t.days.save })).toBeInTheDocument();
  });

  it('updates the cover title as the name changes and switches cover presets', async () => {
    const user = userEvent.setup();
    renderDays();
    await user.click(await screen.findByTestId('days-hero'));
    const dialog = await screen.findByRole('dialog', { name: t.days.edit });

    const name = within(dialog).getByLabelText(t.days.name);
    await user.clear(name);
    await user.type(name, '中秋晚会');
    expect(within(dialog).getByTestId('day-editor-cover-title')).toHaveTextContent('中秋晚会');

    await user.click(within(dialog).getByRole('button', { name: t.days.coverPresets.lantern }));
    expect(within(dialog).getByRole('button', { name: t.days.coverPresets.lantern })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: t.days.coverPresets.moon })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(within(dialog).getByRole('button', { name: t.days.reminder3 }));
    expect(within(dialog).getByRole('button', { name: t.days.reminder3 })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(dialog).getByRole('button', { name: t.days.cancel }));
    expect(screen.queryByRole('dialog', { name: t.days.edit })).not.toBeInTheDocument();
  });

  it('shows delete for a custom day and untitled cover for a new day', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listDays).mockResolvedValue({
      items: [
        sampleDay({
          id: 'd3',
          name: '签证到期',
          source: 'custom',
          catalogKey: null,
          catalogKind: null,
          calendar: 'solar',
          canDelete: true,
          coverPreset: 'night',
          coverUrl: '/days/night.jpg',
          reminderOffsets: [],
          lunarLabel: null,
        }),
      ],
    });
    renderDays();
    await user.click(await screen.findByTestId('days-hero'));
    const edit = await screen.findByRole('dialog', { name: t.days.edit });
    expect(within(edit).getByRole('button', { name: t.days.delete })).toBeInTheDocument();
    expect(within(edit).queryByRole('button', { name: t.days.hide })).not.toBeInTheDocument();
    await user.click(within(edit).getByRole('button', { name: t.days.cancel }));

    await user.click(screen.getByRole('button', { name: `+ ${t.days.add}` }));
    const create = await screen.findByRole('dialog', { name: t.days.creating });
    expect(within(create).getByTestId('day-editor-cover-title')).toHaveTextContent(t.days.untitled);
    expect(within(create).queryByRole('button', { name: t.days.delete })).not.toBeInTheDocument();
    expect(within(create).queryByRole('button', { name: t.days.hide })).not.toBeInTheDocument();
    expect(within(create).getByRole('button', { name: t.days.save })).toBeDisabled();
  });

  it('jumps the solar date picker to a past year from the header', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listDays).mockResolvedValue({ items: [] });
    renderDays();
    await user.click(await screen.findByRole('button', { name: `+ ${t.days.add}` }));
    const create = await screen.findByRole('dialog', { name: t.days.creating });
    await user.click(within(create).getByRole('button', { name: t.days.date }));
    const picker = screen.getByRole('dialog', { name: t.calendar.picker });
    await user.click(within(picker).getByRole('button', { name: t.calendar.selectYear }));
    await user.click(within(picker).getByRole('button', { name: '2019年' }));
    await user.click(within(picker).getByRole('button', { name: '6月' }));
    await user.click(within(picker).getByRole('button', { name: '6月1日' }));
    expect(within(create).getByRole('button', { name: t.days.date })).toHaveTextContent('2019年6月1日');
  });

  it('keeps a today headline out of the hero and on the today banner', async () => {
    vi.mocked(client.listDays).mockResolvedValue({
      items: [
        sampleDay({
          id: 'd-today',
          name: '生日',
          nextYmd: todayYmd,
          headline: { kind: 'today', days: 0, years: 8 },
        }),
        sampleDay({
          id: 'd-soon',
          name: '中秋节',
          headline: { kind: 'countdown', days: 9, years: null },
        }),
      ],
    });
    renderDays();
    const hero = await screen.findByTestId('days-hero');
    expect(within(hero).getByText('中秋节')).toBeInTheDocument();
    expect(within(hero).queryByText('生日')).not.toBeInTheDocument();
    expect(within(hero).queryByText(t.days.today)).not.toBeInTheDocument();
    expect(screen.getByText(t.days.today)).toBeInTheDocument();
    expect(screen.getAllByText('生日').length).toBeGreaterThanOrEqual(1);
  });

  it('hides the hero when the only upcoming day is today', async () => {
    vi.mocked(client.listDays).mockResolvedValue({
      items: [
        sampleDay({
          id: 'd-today',
          name: '生日',
          nextYmd: todayYmd,
          headline: { kind: 'today', days: 0, years: 8 },
        }),
      ],
    });
    renderDays();
    await screen.findByText(t.days.today);
    expect(screen.queryByTestId('days-hero')).not.toBeInTheDocument();
    expect(screen.getAllByText('生日').length).toBeGreaterThanOrEqual(1);
  });
});

describe('draftCoverMeta', () => {
  it('joins solar date, lunar label, and headline', () => {
    expect(lunarDateLabel(8, 15, false)).toBe('农历八月十五');
    expect(lunarDateLabel(8, 15, true)).toBe('农历闰八月十五');
    expect(
      draftCoverMeta(
        {
          calendar: 'lunar',
          anchorYmd: '2026-09-25',
          lunarMonth: 8,
          lunarDay: 15,
          lunarLeap: false,
          repeat: 'yearly',
          displayMode: 'auto',
        },
        '2026-09-16',
      ),
    ).toBe(`2026-09-25 · 农历八月十五 · ${t.days.countdown.replace('{n}', '9')}`);
  });
});

describe('buildDaysTimeline', () => {
  it('maps upcoming days onto a span of at least 3 months', () => {
    const today = '2026-09-16';
    const model = buildDaysTimeline(
      [
        sampleDay({ id: 'a', name: '中秋', nextYmd: '2026-09-25', source: 'statutory' }),
        sampleDay({
          id: 'b',
          name: '妈妈生日',
          nextYmd: '2026-11-08',
          source: 'custom',
          holidayRange: null,
          headline: { kind: 'countdown', days: 53, years: null },
        }),
        sampleDay({
          id: 'c',
          name: '在一起',
          nextYmd: '2027-06-01',
          source: 'custom',
          headline: { kind: 'countup', days: 100, years: 8 },
        }),
      ],
      today,
    );
    expect(model.spanMonths).toBe(3);
    expect(model.endYmd).toBe('2026-12-16');
    expect(model.points.map((p) => p.name)).toEqual(['中秋', '妈妈生日']);
    expect(model.points[0]?.leftPercent).toBeCloseTo((ymdDiffDays(today, '2026-09-25') / ymdDiffDays(today, model.endYmd)) * 100);
    expect(model.points[0]?.amber).toBe(true);
    expect(model.points[1]?.amber).toBe(false);
    expect(model.months[0]?.leftPercent).toBe(0);
    expect(model.months.map((m) => m.month)).toEqual([9, 10, 11, 12]);
  });

  it('extends the axis past the farthest nextYmd and pins today at 0', () => {
    const today = '2026-09-16';
    const model = buildDaysTimeline(
      [
        sampleDay({ id: 'a', name: '春节', nextYmd: '2027-02-06', holidayRange: { from: '2027-02-05', to: '2027-02-11' } }),
      ],
      today,
    );
    expect(model.spanMonths).toBe(5);
    // Right pad keeps the farthest dot slightly inside the track edge.
    expect(model.endYmd > '2027-02-06').toBe(true);
    expect(model.points[0]?.leftPercent).toBeLessThan(100);
    expect(model.points[0]?.leftPercent).toBeCloseTo(
      (ymdDiffDays(today, '2027-02-06') / ymdDiffDays(today, model.endYmd)) * 100,
    );
    expect(model.points[0]?.amber).toBe(true);
  });
});

function assertNoOverlapInLane(placements: TimelineLabelPlacement[]) {
  const byLane = new Map<number, TimelineLabelPlacement[]>();
  for (const item of placements) {
    if (item.lane === null) continue;
    const list = byLane.get(item.lane) ?? [];
    list.push(item);
    byLane.set(item.lane, list);
  }
  for (const list of byLane.values()) {
    const sorted = [...list].sort((a, b) => a.labelLeftPercent - b.labelLeftPercent);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!prev || !cur) continue;
      expect(prev.labelLeftPercent + prev.widthPercent).toBeLessThanOrEqual(cur.labelLeftPercent + 1e-6);
    }
  }
}

describe('pickNextUp', () => {
  it('picks the countdown with the fewest days and ignores today', () => {
    const todayDay = sampleDay({
      id: 't',
      name: '生日',
      headline: { kind: 'today', days: 0, years: 1 },
    });
    const later = sampleDay({
      id: 'l',
      name: '春节',
      headline: { kind: 'countdown', days: 40, years: null },
    });
    const sooner = sampleDay({
      id: 's',
      name: '中秋',
      headline: { kind: 'countdown', days: 8, years: null },
    });
    expect(pickNextUp([todayDay, later, sooner])?.id).toBe('s');
  });

  it('returns null when there is no countdown', () => {
    expect(
      pickNextUp([
        sampleDay({ id: 't', name: '生日', headline: { kind: 'today', days: 0, years: 1 } }),
        sampleDay({
          id: 'u',
          name: '在一起',
          headline: { kind: 'countup', days: 100, years: 1 },
        }),
      ]),
    ).toBeNull();
  });
});

describe('timelineYmd', () => {
  it('drops the year for dates within a year of today', () => {
    expect(timelineYmd('2026-09-25', '2026-09-16')).toBe('09-25');
    expect(timelineYmd('2027-06-20', '2026-09-16')).toBe('06-20');
  });

  it('keeps the full date beyond a year out', () => {
    expect(timelineYmd('2027-10-01', '2026-09-16')).toBe('2027-10-01');
  });
});

describe('clipVerticalLine', () => {
  it('returns one segment when nothing covers the line', () => {
    expect(clipVerticalLine(10, 40, [])).toEqual([{ top: 10, height: 30 }]);
  });

  it('clips around a covering label box and drops slivers', () => {
    expect(clipVerticalLine(10, 60, [{ top: 20, bottom: 36 }])).toEqual([
      { top: 10, height: 10 },
      { top: 36, height: 24 },
    ]);
  });

  it('returns nothing when fully covered', () => {
    expect(clipVerticalLine(10, 40, [{ top: 0, bottom: 50 }])).toEqual([]);
  });
});

describe('assignTimelineLanes', () => {
  it('keeps nearby early labels on separate lanes without overlap', () => {
    const today = '2026-09-17';
    const model = buildDaysTimeline(
      [
        sampleDay({
          id: 'a',
          name: '中秋节',
          nextYmd: '2026-09-25',
          headline: { kind: 'countdown', days: 8, years: null },
        }),
        sampleDay({
          id: 'b',
          name: '国庆节',
          nextYmd: '2026-10-01',
          headline: { kind: 'countdown', days: 14, years: null },
        }),
        sampleDay({
          id: 'c',
          name: '重阳',
          nextYmd: '2026-10-18',
          headline: { kind: 'countdown', days: 31, years: null },
        }),
      ],
      today,
    );
    const containerWidthPx = 640;
    const todayLabel = '今天 09-17';
    const layout = assignTimelineLanes(
      model.points.map((point) => ({
        id: point.id,
        name: point.name,
        dateText: shortYmd(point.nextYmd, today),
        leftPercent: point.leftPercent,
      })),
      { containerWidthPx, todayLabel },
    );
    expect(layout.placements.every((item) => item.lane !== null)).toBe(true);
    expect(new Set(layout.placements.map((item) => item.lane)).size).toBeGreaterThan(1);
    assertNoOverlapInLane(layout.placements);
    const todayWidthPct = (estimateTextWidthPx(todayLabel) / containerWidthPx) * 100;
    for (const item of layout.placements) {
      if (item.lane !== 0) continue;
      expect(item.labelLeftPercent).toBeGreaterThanOrEqual(todayWidthPct - 1e-6);
    }
  });

  it('gives the closer date the lane nearer the axis', () => {
    const layout = assignTimelineLanes(
      [
        { id: 'far', name: '妈妈的生日宴会', dateText: '11-08', leftPercent: 48 },
        { id: 'near', name: '中秋节晚会夜', dateText: '09-25', leftPercent: 40 },
      ],
      { containerWidthPx: 400, todayLabel: '今天 09-17' },
    );
    const near = layout.placements.find((item) => item.id === 'near');
    const far = layout.placements.find((item) => item.id === 'far');
    expect(near?.lane).toEqual(expect.any(Number));
    expect(far?.lane).toEqual(expect.any(Number));
    expect(near?.lane ?? 99).toBeLessThan(far?.lane ?? -1);
  });

  it('omits labels that cannot fit in three lanes', () => {
    const points = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      name: '春节联欢晚会',
      dateText: '01-28',
      leftPercent: 50,
    }));
    const layout = assignTimelineLanes(points, {
      containerWidthPx: 480,
      todayLabel: '今天 01-28',
    });
    const shown = layout.placements.filter((item) => item.lane !== null);
    const hidden = layout.placements.filter((item) => item.lane === null);
    expect(shown).toHaveLength(TIMELINE_MAX_LANES);
    expect(hidden).toHaveLength(5);
    expect(shown.map((item) => item.lane).sort()).toEqual([0, 1, 2]);
    expect(layout.lanesUsed).toBe(TIMELINE_MAX_LANES);
    assertNoOverlapInLane(layout.placements);
  });

  it('grows the track as more lanes are used', () => {
    expect(timelineTrackMetrics(3).height).toBeGreaterThan(timelineTrackMetrics(1).height);
    expect(timelineTrackMetrics(3).axisTop).toBeGreaterThan(timelineTrackMetrics(1).axisTop);
  });
});
