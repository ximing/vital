import type { InboxItem, InboxPreview } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  archivedSaves,
  createInputFromPreview,
  filterSaves,
  hostLabel,
  inboxHref,
  normalizePasteUrl,
  parseInboxFilter,
  parseInboxTagId,
  pendingIdForUrl,
  visibleSaves,
} from '../../../src/features/inbox/model';

function makeItem(over: Partial<InboxItem> & Pick<InboxItem, 'id' | 'title'>): InboxItem {
  return {
    originalUrl: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    extractedText: 'Hello',
    extractedHtml: '<p>Hello</p>',
    excerpt: 'Hello',
    byline: null,
    siteName: 'example.com',
    status: 'unread',
    source: 'web',
    capturedAt: '2026-09-06T00:00:00.000Z',
    readAt: null,
    convertedTaskId: null,
    tagIds: [],
    assets: [],
    deletedAt: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    ...over,
  };
}

describe('normalizePasteUrl', () => {
  it('accepts http(s) and fills https for bare hosts', () => {
    expect(normalizePasteUrl('https://Example.com/a')).toBe('https://Example.com/a');
    expect(normalizePasteUrl('example.com/a')).toBe('https://example.com/a');
    expect(normalizePasteUrl('file:///etc/passwd')).toBeNull();
    expect(normalizePasteUrl('just a note')).toBeNull();
  });
});

describe('visibleSaves / archivedSaves', () => {
  it('drops archived saves from the default list', () => {
    const unread = makeItem({ id: 'a', title: 'A', capturedAt: '2026-09-06T02:00:00.000Z' });
    const later = makeItem({
      id: 'b',
      title: 'B',
      status: 'later',
      capturedAt: '2026-09-06T01:00:00.000Z',
    });
    const archived = makeItem({ id: 'c', title: 'C', status: 'archived' });
    expect(visibleSaves([archived, later, unread]).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('exposes archived saves so the list can open them again', () => {
    const unread = makeItem({ id: 'a', title: 'A', capturedAt: '2026-09-06T02:00:00.000Z' });
    const archived = makeItem({
      id: 'c',
      title: 'C',
      status: 'archived',
      capturedAt: '2026-09-06T03:00:00.000Z',
    });
    const older = makeItem({
      id: 'd',
      title: 'D',
      status: 'archived',
      capturedAt: '2026-09-06T01:00:00.000Z',
    });
    const deleted = makeItem({
      id: 'e',
      title: 'E',
      status: 'archived',
      deletedAt: '2026-09-06T04:00:00.000Z',
    });
    expect(archivedSaves([deleted, unread, archived, older]).map((item) => item.id)).toEqual([
      'c',
      'd',
    ]);
  });
});

describe('parseInboxFilter / filterSaves', () => {
  it('parses only known filters, defaulting to all', () => {
    expect(parseInboxFilter(null)).toBe('all');
    expect(parseInboxFilter('unread')).toBe('unread');
    expect(parseInboxFilter('favorite')).toBe('favorite');
    expect(parseInboxFilter('archived')).toBe('archived');
    expect(parseInboxFilter('nonsense')).toBe('all');
  });

  it('filters by status, newest first, excluding deleted', () => {
    const unread = makeItem({ id: 'a', title: 'A', capturedAt: '2026-09-06T02:00:00.000Z' });
    const later = makeItem({
      id: 'b',
      title: 'B',
      status: 'later',
      capturedAt: '2026-09-06T03:00:00.000Z',
    });
    const archived = makeItem({ id: 'c', title: 'C', status: 'archived' });
    const deleted = makeItem({ id: 'e', title: 'E', deletedAt: '2026-09-06T04:00:00.000Z' });
    const items = [deleted, unread, later, archived];
    expect(filterSaves(items, 'all').map((item) => item.id)).toEqual(['b', 'a']);
    expect(filterSaves(items, 'unread').map((item) => item.id)).toEqual(['a']);
    expect(filterSaves(items, 'favorite').map((item) => item.id)).toEqual(['b']);
    expect(filterSaves(items, 'archived').map((item) => item.id)).toEqual(['c']);
  });

  it('filters by tag and composes inbox hrefs', () => {
    const tag = '11111111-1111-4111-8111-111111111111';
    const tagged = makeItem({ id: 'a', title: 'A', tagIds: [tag] });
    const plain = makeItem({ id: 'b', title: 'B' });
    expect(filterSaves([tagged, plain], 'all', tag).map((item) => item.id)).toEqual(['a']);
    expect(parseInboxTagId(tag)).toBe(tag);
    expect(parseInboxTagId('nope')).toBeNull();
    expect(inboxHref('unread', tag)).toBe(`/inbox?filter=unread&tag=${tag}`);
    expect(inboxHref('all', null)).toBe('/inbox');
  });
});

describe('createInputFromPreview', () => {
  it('keeps originalUrl and web source', () => {
    const preview: InboxPreview = {
      title: 'Example Domain',
      originalUrl: 'https://example.com/a',
      canonicalUrl: 'https://example.com/a',
      extractedText: 'Hello',
      extractedHtml: '<p>Hello</p>',
      excerpt: 'Hello',
      byline: null,
      siteName: 'example.com',
      status: 'unread',
      source: 'web',
      readAt: null,
      convertedTaskId: null,
      tagIds: [],
      assets: [],
    };
    expect(createInputFromPreview(preview, '  New  ')).toEqual({
      title: 'New',
      originalUrl: 'https://example.com/a',
      extractedText: 'Hello',
      extractedHtml: '<p>Hello</p>',
      excerpt: 'Hello',
      byline: null,
      siteName: 'example.com',
      source: 'web',
    });
    expect(pendingIdForUrl('https://example.com/a')).toBe('url:https://example.com/a');
    expect(hostLabel('https://www.example.com/a')).toBe('example.com');
  });
});
