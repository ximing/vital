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
});
