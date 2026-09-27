import { describe, expect, it } from 'vitest';
import { parseVitalPushUrl, routeForVitalPushUrl } from '../../src/lib/push-link';

const ID = '28b81333-ef47-4424-93ff-591fa12b497e';

describe('parseVitalPushUrl', () => {
  it('reads a task tap', () => {
    expect(parseVitalPushUrl(`vital://task/${ID}`)).toEqual({ kind: 'task', id: ID });
  });

  it('reads today and ignores other urls', () => {
    expect(parseVitalPushUrl('vital://today')).toEqual({ kind: 'today' });
    expect(parseVitalPushUrl('https://vital.aimo.plus/today')).toBeNull();
  });
});

describe('routeForVitalPushUrl', () => {
  it('sends a task tap home instead of a missing /task route', () => {
    expect(routeForVitalPushUrl(`vital://task/${ID}`)).toBe('/');
    expect(routeForVitalPushUrl(`task/${ID}`)).toBe('/');
  });

  it('keeps day taps on the days screen', () => {
    expect(routeForVitalPushUrl(`vital://day/${ID}`)).toBe(`/days?id=${ID}`);
  });
});
