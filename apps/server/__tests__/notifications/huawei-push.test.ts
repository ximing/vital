import { afterEach, describe, expect, it } from 'vitest';
import {
  huaweiClickIntent,
  huaweiMessageBody,
  sendHuaweiPush,
  setHuaweiTransport,
} from '../../src/notifications/huawei-push.js';

const TASK = '28b81333-ef47-4424-93ff-591fa12b497e';

afterEach(() => {
  setHuaweiTransport(null);
});

describe('huawei push', () => {
  it('opens the app on the task when the notification is tapped', () => {
    const intent = huaweiClickIntent({ kind: 'task', id: TASK });
    expect(intent).toContain('scheme=vital');
    expect(intent).toContain(`task/${TASK}`);
    expect(intent.endsWith(';end')).toBe(true);
    const body = huaweiMessageBody('任务提醒', '写周报', { kind: 'task', id: TASK }, 'tok');
    const message = body.message as { android: { category: string; notification: { click_action: { type: number } } } };
    expect(message.android.category).toBe('WORK');
    expect(message.android.notification.click_action.type).toBe(1);
  });

  it('treats an invalid device token as permanent', async () => {
    setHuaweiTransport({
      postForm: async () => ({ httpStatus: 200, json: { access_token: 't', expires_in: 3600 } }),
      postJson: async () => ({ httpStatus: 200, json: { code: '80300007', msg: 'All the tokens are invalid' } }),
    });
    const result = await sendHuaweiPush({
      token: 'gone',
      title: '任务提醒',
      body: '写周报',
      target: { kind: 'task', id: TASK },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.permanent).toBe(true);
      expect(result.invalidToken).toBe(true);
    }
  });
});
