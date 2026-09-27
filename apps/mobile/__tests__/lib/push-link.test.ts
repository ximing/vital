import { describe, expect, it } from 'vitest';
import { parseVitalPushUrl } from '../../src/lib/push-link';

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
