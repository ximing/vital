import { afterEach, describe, expect, it } from 'vitest';
import { meowPushUrl, sendMeow, setMeowTransport } from '../../src/notifications/meow.js';

afterEach(() => {
  setMeowTransport(null);
});

describe('sendMeow', () => {
  it('treats JSON status 200 as success even if HTTP is 200 with other shapes', async () => {
    setMeowTransport({
      postJson: () => Promise.resolve({ httpStatus: 200, json: { status: 200, message: '推送成功' } }),
    });
    const result = await sendMeow({ nickname: 'Ada', title: 't', msg: 'm' });
    expect(result).toEqual({ ok: true });
  });

  it('marks 404 as permanent', async () => {
    setMeowTransport({
      postJson: () => Promise.resolve({ httpStatus: 200, json: { status: 404, msg: '昵称未注册' } }),
    });
    const result = await sendMeow({ nickname: 'missing', title: 't', msg: 'm' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.permanent).toBe(true);
      expect(result.status).toBe(404);
    }
  });

  it('retries 429', async () => {
    setMeowTransport({
      postJson: () => Promise.resolve({ httpStatus: 200, json: { status: 429, msg: 'too many' } }),
    });
    const result = await sendMeow({ nickname: 'Ada', title: 't', msg: 'm' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).toBe(false);
  });

  it('encodes nickname in the path and uses POST JSON URL', () => {
    expect(meowPushUrl('席铭', 'https://api.chuckfang.com')).toBe(
      'https://api.chuckfang.com/%E5%B8%AD%E9%93%AD?msgType=text',
    );
  });
});
