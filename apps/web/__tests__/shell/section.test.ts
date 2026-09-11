import { describe, expect, it } from 'vitest';
import { listIdFrom, rhythmHref, sectionOf } from '../../src/shell/section';

describe('app section', () => {
  it('maps routes to primary sections', () => {
    expect(sectionOf('/today', '')).toBe('today');
    expect(sectionOf('/todos/lists/smart:today', '')).toBe('todos');
    expect(sectionOf('/todos/lists/smart:someday', '')).toBe('todos');
    expect(sectionOf('/todos/calendar', 'list=smart:today')).toBe('todos');
    expect(sectionOf('/todos/lists/smart:inbox', '')).toBe('todos');
    expect(sectionOf('/todos/lists/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '')).toBe('todos');
    expect(sectionOf('/inbox', '')).toBe('capture');
    expect(sectionOf('/inbox/x', '')).toBe('capture');
    expect(sectionOf('/reports', '')).toBe('reflect');
    expect(sectionOf('/reports/id', 'type=weekly')).toBe('reflect');
    expect(sectionOf('/search', '')).toBe('search');
    expect(sectionOf('/habits', '')).toBe('habits');
    expect(sectionOf('/threads', '')).toBe('threads');
    expect(sectionOf('/activity', '')).toBe('activity');
    expect(sectionOf('/memory', '')).toBe('memory');
    expect(sectionOf('/usage', '')).toBe('usage');
    expect(sectionOf('/settings', '')).toBe('settings');
  });

  it('keeps list/board/week when switching todo lists', () => {
    expect(listIdFrom('/todos/lists/smart:today', '')).toBe('smart:today');
    expect(rhythmHref('smart:upcoming', '/todos/lists/smart:today')).toBe(
      '/todos/lists/smart:upcoming',
    );
    expect(rhythmHref('smart:today', '/todos/board')).toBe('/todos/board?list=smart%3Atoday');
    expect(rhythmHref('smart:today', '/todos/calendar')).toBe('/todos/calendar?list=smart%3Atoday');
  });
});
