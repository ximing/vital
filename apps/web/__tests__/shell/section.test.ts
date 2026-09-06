import { describe, expect, it } from 'vitest';
import { listIdFrom, rhythmHref, sectionOf } from '../../src/shell/section';

describe('app section', () => {
  it('maps routes to primary sections', () => {
    expect(sectionOf('/todos/lists/smart:today', '')).toBe('rhythm');
    expect(sectionOf('/todos/lists/smart:someday', '')).toBe('rhythm');
    expect(sectionOf('/todos/calendar', 'list=smart:today')).toBe('rhythm');
    expect(sectionOf('/todos/lists/smart:inbox', '')).toBe('lists');
    expect(sectionOf('/todos/lists/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '')).toBe('lists');
    expect(sectionOf('/inbox', '')).toBe('capture');
    expect(sectionOf('/inbox/x', '')).toBe('capture');
    expect(sectionOf('/reports', '')).toBe('reflect');
    expect(sectionOf('/reports/id', 'type=weekly')).toBe('reflect');
    expect(sectionOf('/search', '')).toBe('search');
    expect(sectionOf('/settings', '')).toBe('settings');
  });

  it('keeps list/board/week when switching rhythm lists', () => {
    expect(listIdFrom('/todos/lists/smart:today', '')).toBe('smart:today');
    expect(rhythmHref('smart:upcoming', '/todos/lists/smart:today')).toBe(
      '/todos/lists/smart:upcoming',
    );
    expect(rhythmHref('smart:today', '/todos/board')).toBe('/todos/board?list=smart%3Atoday');
    expect(rhythmHref('smart:today', '/todos/calendar')).toBe('/todos/calendar?list=smart%3Atoday');
  });
});
