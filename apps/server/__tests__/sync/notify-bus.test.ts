import { afterAll, describe, expect, it } from 'vitest';
import { emitNotify, startNotifyBus, stopNotifyBus } from '../../src/sync/notify-bus.js';
import {
  deliverLocalNotification,
  subscribe,
  unsubscribe,
  type SyncSocket,
} from '../../src/sync/sync.hub.js';

describe('notify bus', () => {
  afterAll(async () => {
    await stopNotifyBus();
  });

  it('forwards a push from another database session into the local room', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const messages: string[] = [];
    const socket: SyncSocket = {
      send: (data) => {
        messages.push(data);
      },
      close() {},
      ping() {},
      on() {},
      readyState: 1,
      OPEN: 1,
    };
    subscribe(userId, socket);
    try {
      await startNotifyBus((message) => {
        deliverLocalNotification(message.userId, {
          type: 'notify',
          id: message.id,
          title: message.title,
          body: message.body,
          url: message.url,
        });
      });
      await emitNotify({
        userId,
        id: 'brief-1',
        title: '晨报',
        body: '站会和评审之间有 1 小时空档，建议把写报告挪到这段或明天',
        url: '/today',
      });
      const deadline = Date.now() + 3_000;
      while (messages.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      unsubscribe(userId, socket);
    }
    expect(JSON.parse(messages[0] ?? '{}')).toEqual({
      type: 'notify',
      id: 'brief-1',
      title: '晨报',
      body: '站会和评审之间有 1 小时空档，建议把写报告挪到这段或明天',
      url: '/today',
    });
  });
});
