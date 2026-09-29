import { describe, expect, it } from 'vitest';
import type { LlmSettingsPublic } from '@vital/dto';
import { fromDatetimeLocal, zonedLocalMidnightIso } from '../../../src/lib/format';
import { composeTaskRequest, smartListIdOf } from '../../../src/features/todos/compose-task';

const TZ = 'Asia/Shanghai';
const LIST = '22222222-2222-4222-8222-222222222222';
const TAG = '33333333-3333-4333-8333-333333333333';

const routed: LlmSettingsPublic = {
  providers: [
    {
      id: 'p1',
      providerId: 'custom',
      label: 'GLM',
      baseUrl: null,
      models: ['glm-4-flash'],
      apiKeySet: true,
    },
  ],
  routing: { default: { providerId: 'p1', model: 'glm-4-flash' } },
};

const base = {
  text: '明天下午3点和设计组开会',
  listId: LIST,
  timezone: TZ,
  due: { source: 'preset' as const },
  priority: null,
  tagIds: [] as string[],
};

describe('composeTaskRequest', () => {
  it('parses a Today compose even when the view already implies a due date', () => {
    const dueAt = zonedLocalMidnightIso(TZ, '2026-09-29');
    expect(
      composeTaskRequest({
        ...base,
        llm: routed,
        smartListId: 'smart:today',
        extra: { dueAt, isAllDay: true, timezone: TZ },
      }),
    ).toEqual({
      kind: 'text',
      body: {
        text: base.text,
        listId: LIST,
        timezone: TZ,
        smartListId: 'smart:today',
      },
    });
  });

  it('parses when only task.parse is routed', () => {
    expect(
      composeTaskRequest({
        ...base,
        llm: {
          ...routed,
          routing: { 'task.parse': { providerId: 'p1', model: 'glm-4-flash' } },
        },
        smartListId: 'smart:inbox',
      }),
    ).toEqual({
      kind: 'text',
      body: {
        text: base.text,
        listId: LIST,
        timezone: TZ,
        smartListId: 'smart:inbox',
      },
    });
  });

  it('sends the week day as a fallback due and keeps an explicit priority', () => {
    expect(
      composeTaskRequest({
        ...base,
        llm: routed,
        smartListId: 'smart:upcoming',
        contextDueYmd: '2026-10-02',
        priority: 1,
        extra: { status: 'doing' },
      }),
    ).toEqual({
      kind: 'text',
      body: {
        text: base.text,
        listId: LIST,
        timezone: TZ,
        smartListId: 'smart:upcoming',
        dueYmd: '2026-10-02',
        priority: 1,
        status: 'doing',
      },
    });
  });

  it('keeps a structured create when no model can parse', () => {
    const dueAt = zonedLocalMidnightIso(TZ, '2026-09-29');
    expect(
      composeTaskRequest({
        ...base,
        llm: { providers: [], routing: {} },
        smartListId: 'smart:today',
        extra: { dueAt, isAllDay: true, timezone: TZ },
      }),
    ).toEqual({
      kind: 'fields',
      body: {
        title: base.text,
        listId: LIST,
        dueAt,
        isAllDay: true,
        timezone: TZ,
      },
    });
  });

  it('keeps a date or tag the user picked instead of asking the model', () => {
    expect(
      composeTaskRequest({
        ...base,
        llm: routed,
        smartListId: 'smart:today',
        due: { source: 'day', ymd: '2026-09-30', allDay: false, hm: '14:00' },
      }).body,
    ).toEqual({
      title: base.text,
      listId: LIST,
      timezone: TZ,
      dueAt: fromDatetimeLocal('2026-09-30T14:00', TZ),
      isAllDay: false,
    });
    expect(
      composeTaskRequest({
        ...base,
        llm: routed,
        tagIds: [TAG],
        extra: { dueAt: zonedLocalMidnightIso(TZ, '2026-09-29'), isAllDay: true, timezone: TZ },
      }).body,
    ).toMatchObject({ title: base.text, tagIds: [TAG], isAllDay: true });
  });

  it('drops the view due when the user clears the date', () => {
    expect(
      composeTaskRequest({
        ...base,
        llm: routed,
        due: { source: 'none' },
        extra: { dueAt: zonedLocalMidnightIso(TZ, '2026-09-29'), isAllDay: true, timezone: TZ },
      }).body,
    ).toEqual({ title: base.text, listId: LIST });
  });
});

describe('smartListIdOf', () => {
  it('accepts only known smart lists', () => {
    expect(smartListIdOf('smart:today')).toBe('smart:today');
    expect(smartListIdOf(LIST)).toBeUndefined();
    expect(smartListIdOf('smart:nope')).toBeUndefined();
  });
});
