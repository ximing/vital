import { describe, expect, it } from 'vitest';
import { neighborWarms, warmTarget } from '../../src/shell/warm';

describe('route warmup', () => {
  it('warms primary rail targets and leaves settings-family paths cold', () => {
    expect(warmTarget('/today')).toBe('today');
    expect(warmTarget('/todos/lists/smart:today')).toBe('todos');
    expect(warmTarget('/inbox/abc')).toBe('inbox');
    expect(warmTarget('/habits')).toBe('habits');
    expect(warmTarget('/reports?type=weekly')).toBe('reports');
    expect(warmTarget('/days')).toBe('days');
    expect(warmTarget('/threads')).toBe('threads');
    expect(warmTarget('/settings')).toBeNull();
    expect(warmTarget('/usage')).toBeNull();
    expect(warmTarget('/memory')).toBeNull();
    expect(warmTarget('/activity')).toBeNull();
    expect(warmTarget('/login')).toBeNull();
    expect(warmTarget('/search')).toBeNull();
  });

  it('idles the neighbors of the page that just painted', () => {
    expect(neighborWarms('today')).toEqual(['todos', 'inbox', 'notes']);
    expect(neighborWarms('todos')).toEqual(['today', 'inbox', 'notes']);
    expect(neighborWarms('capture')).toEqual(['today', 'todos']);
    expect(neighborWarms('reflect')).toEqual(['report-editor']);
    expect(neighborWarms('settings')).toEqual([]);
    expect(neighborWarms('activity')).toEqual([]);
    expect(neighborWarms('memory')).toEqual([]);
    expect(neighborWarms('usage')).toEqual([]);
  });
});
