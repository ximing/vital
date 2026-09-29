import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { List, Tag } from '@vital/dto';
import {
  buildCreateInputFromIntent,
  extractedOf,
  parseModelJson,
} from '../../src/llm/parse-task.js';

const inbox: List = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'inbox',
  name: '收集箱',
  color: null,
  icon: null,
  iconAttachmentId: null,
  iconUrl: null,
  parentId: null,
  sortOrder: 0,
  pinned: false,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const work: List = {
  ...inbox,
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'user',
  name: '工作',
};

const tags: Tag[] = [
  { id: '33333333-3333-4333-8333-333333333333', name: '会议', color: null, createdAt: inbox.createdAt },
];

const ctx = { lists: [inbox, work], tags, inboxId: inbox.id };

describe('parseModelJson', () => {
  it('reads fenced JSON and a raw object', () => {
    expect(parseModelJson('```json\n{"title":"开会"}\n```')).toEqual({ title: '开会' });
    expect(parseModelJson('here {"title":"买奶"} trailing')).toEqual({ title: '买奶' });
  });
});

describe('buildCreateInputFromIntent', () => {
  it('maps a dated timed meeting onto create payload', () => {
    const extracted = extractedOf({
      title: '和设计组开会',
      notes: '讨论 Q3',
      priority: 1,
      dueDate: '2026-09-09',
      dueTime: '15:00',
      isAllDay: false,
      reminder: '15',
      listName: '工作',
      tagNames: ['会议'],
    });
    const payload = buildCreateInputFromIntent(
      { text: '明天下午3点和设计组开会讨论Q3', timezone: 'Asia/Shanghai' },
      extracted,
      ctx,
    );
    expect(payload.title).toBe('和设计组开会');
    expect(payload.notes).toBe('讨论 Q3');
    expect(payload.priority).toBe(1);
    expect(payload.listId).toBe(work.id);
    expect(payload.tagIds).toEqual([tags[0]?.id]);
    expect(payload.isAllDay).toBe(false);
    expect(payload.reminderMode).toBe('offset');
    expect(payload.reminderOffsetMinutes).toBe(15);
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-09 15:00');
  });

  it('uses today as all-day due when viewing smart:today and model omitted a date', () => {
    const now = new Date('2026-09-08T04:00:00.000Z');
    const payload = buildCreateInputFromIntent(
      {
        text: '买牛奶',
        timezone: 'Asia/Shanghai',
        smartListId: 'smart:today',
      },
      extractedOf({ title: '买牛奶', dueDate: null, priority: 3 }),
      { ...ctx, now },
    );
    expect(payload.title).toBe('买牛奶');
    expect(payload.isAllDay).toBe(true);
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-08 00:00');
  });

  it('does not force today when the model says someday', () => {
    const payload = buildCreateInputFromIntent(
      { text: '某天读完这本书', timezone: 'Asia/Shanghai', smartListId: 'smart:today' },
      extractedOf({ title: '读完这本书', someday: true, dueDate: null }),
      ctx,
    );
    expect(payload.dueAt).toBeNull();
  });

  it('keeps a locked board priority over the model', () => {
    const payload = buildCreateInputFromIntent(
      { text: '修 bug', timezone: 'Asia/Shanghai', priority: 0 },
      extractedOf({ title: '修 bug', priority: 3 }),
      ctx,
    );
    expect(payload.priority).toBe(0);
  });

  it('turns 每间隔两个月 at 21:00 into a timed two-month task', () => {
    const text = '每间隔两个月的晚上九点提醒我用油擦一下菜板';
    const now = new Date('2026-09-08T04:00:00.000Z');
    const payload = buildCreateInputFromIntent(
      { text, timezone: 'Asia/Shanghai', smartListId: 'smart:today' },
      extractedOf({
        title: '用油擦一下菜板',
        dueDate: null,
        dueTime: null,
        isAllDay: true,
        reminder: 'none',
        recurrenceKind: 'weekly',
        priority: 3,
      }),
      { ...ctx, now },
    );
    expect(payload.title).toBe('用油擦一下菜板');
    expect(payload.isAllDay).toBe(false);
    expect(payload.recurrence).toBe('FREQ=MONTHLY;INTERVAL=2');
    expect(payload.recurrenceKind).toBeUndefined();
    expect(payload.reminderMode).toBe('due');
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-08 21:00');
  });

  it('uses a model interval when the sentence does not say 每隔', () => {
    const now = new Date('2026-09-08T04:00:00.000Z');
    const payload = buildCreateInputFromIntent(
      { text: '用油擦一下菜板', timezone: 'Asia/Shanghai', smartListId: 'smart:today' },
      extractedOf({
        title: '用油擦一下菜板',
        dueDate: null,
        dueTime: '21:00',
        isAllDay: true,
        reminder: 'due',
        recurrenceKind: 'monthly',
        recurrenceInterval: '2',
      }),
      { ...ctx, now },
    );
    expect(payload.recurrence).toBe('FREQ=MONTHLY;INTERVAL=2');
    expect(payload.recurrenceKind).toBeUndefined();
    expect(payload.isAllDay).toBe(false);
    expect(payload.reminderMode).toBe('due');
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-08 21:00');
  });

  it('reads 每2个月 and 晚上9点 the same way', () => {
    const now = new Date('2026-09-08T04:00:00.000Z');
    const payload = buildCreateInputFromIntent(
      { text: '每2个月的晚上9点提醒我擦菜板', timezone: 'Asia/Shanghai', smartListId: 'smart:today' },
      extractedOf({ title: '擦菜板', dueDate: null }),
      { ...ctx, now },
    );
    expect(payload.recurrence).toBe('FREQ=MONTHLY;INTERVAL=2');
    expect(payload.reminderMode).toBe('due');
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-08 21:00');
  });

  it('reads 每隔两周 and 三点半', () => {
    const now = new Date('2026-09-08T04:00:00.000Z');
    const payload = buildCreateInputFromIntent(
      { text: '每隔两周的下午三点半提醒我擦窗', timezone: 'Asia/Shanghai', smartListId: 'smart:today' },
      extractedOf({ title: '擦窗', dueDate: null }),
      { ...ctx, now },
    );
    expect(payload.recurrence).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(payload.reminderMode).toBe('due');
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-08 15:30');
  });

  it('keeps a context day when the sentence only names a clock', () => {
    const payload = buildCreateInputFromIntent(
      {
        text: '每间隔两个月的晚上九点提醒我用油擦一下菜板',
        timezone: 'Asia/Shanghai',
        dueYmd: '2026-10-02',
        smartListId: 'smart:upcoming',
      },
      extractedOf({ title: '用油擦一下菜板', dueDate: null, reminder: 'none' }),
      ctx,
    );
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-10-02 21:00');
    expect(payload.recurrence).toBe('FREQ=MONTHLY;INTERVAL=2');
  });

  it('drops a bad interval and keeps weekday recurrence as a kind', () => {
    const extracted = extractedOf({
      title: '站会',
      dueDate: '2026-09-09',
      recurrenceKind: 'weekdays',
      recurrenceInterval: 'nope',
    });
    expect(extracted.recurrenceInterval).toBeUndefined();
    const payload = buildCreateInputFromIntent(
      { text: '工作日站会', timezone: 'Asia/Shanghai' },
      extracted,
      ctx,
    );
    expect(payload.recurrenceKind).toBe('weekdays');
    expect(payload.recurrence).toBeUndefined();
  });

  it('ignores an unknown recurrence kind', () => {
    expect(extractedOf({ title: '买牛奶', recurrenceKind: 'biweekly' }).recurrenceKind).toBeNull();
  });

  it('keeps an explicit 15 minute reminder', () => {
    const payload = buildCreateInputFromIntent(
      { text: '提醒我明天下午三点开会', timezone: 'Asia/Shanghai' },
      extractedOf({
        title: '开会',
        dueDate: '2026-09-09',
        dueTime: '15:00',
        reminder: '15',
        isAllDay: false,
      }),
      ctx,
    );
    expect(payload.reminderMode).toBe('offset');
    expect(payload.reminderOffsetMinutes).toBe(15);
    expect(payload.recurrence).toBeUndefined();
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-09 15:00');
  });

  it('keeps a numeric 15 minute reminder and still applies the spoken interval', () => {
    const now = new Date('2026-09-08T04:00:00.000Z');
    const payload = buildCreateInputFromIntent(
      {
        text: '每间隔两个月的晚上九点提醒我用油擦一下菜板',
        timezone: 'Asia/Shanghai',
        smartListId: 'smart:today',
      },
      extractedOf({
        title: '用油擦一下菜板',
        dueDate: null,
        isAllDay: 'true',
        reminder: 15,
        recurrenceKind: 'monthly',
      }),
      { ...ctx, now },
    );
    expect(payload.reminderMode).toBe('offset');
    expect(payload.reminderOffsetMinutes).toBe(15);
    expect(payload.recurrence).toBe('FREQ=MONTHLY;INTERVAL=2');
    expect(payload.isAllDay).toBe(false);
  });

  it('treats an unknown reminder as omitted so 提醒我 means at the clock', () => {
    const now = new Date('2026-09-08T04:00:00.000Z');
    const payload = buildCreateInputFromIntent(
      {
        text: '每间隔两个月的晚上九点提醒我用油擦一下菜板',
        timezone: 'Asia/Shanghai',
        smartListId: 'smart:today',
      },
      extractedOf({ title: '用油擦一下菜板', dueDate: null, reminder: 'soon' }),
      { ...ctx, now },
    );
    expect(payload.reminderMode).toBe('due');
    expect(payload.recurrence).toBe('FREQ=MONTHLY;INTERVAL=2');
  });

  it('does not treat a bare 点 as a clock', () => {
    const now = new Date('2026-09-08T04:00:00.000Z');
    const payload = buildCreateInputFromIntent(
      { text: '九点开会', timezone: 'Asia/Shanghai', smartListId: 'smart:today' },
      extractedOf({ title: '开会', dueDate: null }),
      { ...ctx, now },
    );
    expect(payload.isAllDay).toBe(true);
    expect(payload.recurrence).toBeUndefined();
    const due = DateTime.fromISO(payload.dueAt ?? '', { zone: 'utc' }).setZone('Asia/Shanghai');
    expect(due.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-08 00:00');
  });
});
