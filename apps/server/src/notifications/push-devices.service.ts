import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PushProvider } from '@vital/dto';
import { getDb } from '../db/index.js';
import { pushDeliveries, pushDevices, type NotificationOutboxRow } from '../db/schema.js';
import { huaweiPushConfigured, pushTargetOf, sendHuaweiPush } from './huawei-push.js';

export async function upsertPushDevice(
  userId: string,
  provider: PushProvider,
  token: string,
): Promise<{ id: string; provider: PushProvider }> {
  const now = new Date();
  const existing = await getDb()
    .select()
    .from(pushDevices)
    .where(and(eq(pushDevices.provider, provider), eq(pushDevices.token, token)))
    .limit(1);
  const found = existing[0];
  if (found) {
    await getDb()
      .update(pushDevices)
      .set({ userId, updatedAt: now })
      .where(eq(pushDevices.id, found.id));
    return { id: found.id, provider };
  }
  const id = randomUUID();
  await getDb().insert(pushDevices).values({
    id,
    userId,
    provider,
    token,
    createdAt: now,
    updatedAt: now,
  });
  return { id, provider };
}

export type HuaweiDeliverySummary = {
  skipped: boolean;
  allSent: boolean;
  allDone: boolean;
  retryable: boolean;
  lastError: string | null;
};

export async function deliverHuaweiForJob(
  job: NotificationOutboxRow,
  now: Date,
  copy: { title: string; msg: string },
): Promise<HuaweiDeliverySummary> {
  if (!huaweiPushConfigured()) {
    return { skipped: true, allSent: true, allDone: true, retryable: false, lastError: null };
  }
  const devices = await getDb()
    .select()
    .from(pushDevices)
    .where(and(eq(pushDevices.userId, job.userId), eq(pushDevices.provider, 'huawei')));
  if (devices.length === 0) {
    return { skipped: true, allSent: true, allDone: true, retryable: false, lastError: null };
  }

  const priorRows = await getDb()
    .select()
    .from(pushDeliveries)
    .where(eq(pushDeliveries.outboxId, job.id));
  const prior = new Map(priorRows.map((row) => [row.deviceId, row]));
  const target = pushTargetOf(job);
  let retryable = false;
  let lastError: string | null = null;

  for (const device of devices) {
    const done = prior.get(device.id);
    if (done?.status === 'sent' || (done?.status === 'failed' && done.permanent)) continue;
    const result = await sendHuaweiPush({
      token: device.token,
      title: copy.title,
      body: copy.msg,
      target,
    });
    const status = result.ok ? 'sent' : 'failed';
    const permanent = !result.ok && result.permanent;
    if (!result.ok) {
      lastError = result.error;
      if (!result.permanent) retryable = true;
      if (result.invalidToken) {
        await getDb().delete(pushDevices).where(eq(pushDevices.id, device.id));
      }
    }
    if (done) {
      await getDb()
        .update(pushDeliveries)
        .set({
          status,
          permanent,
          lastError: result.ok ? null : result.error.slice(0, 500),
          sentAt: result.ok ? now : null,
          updatedAt: now,
        })
        .where(eq(pushDeliveries.id, done.id));
    } else {
      await getDb().insert(pushDeliveries).values({
        id: randomUUID(),
        outboxId: job.id,
        deviceId: device.id,
        status,
        permanent,
        lastError: result.ok ? null : result.error.slice(0, 500),
        sentAt: result.ok ? now : null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const after = await getDb()
    .select()
    .from(pushDeliveries)
    .where(eq(pushDeliveries.outboxId, job.id));
  const byDevice = new Map(after.map((row) => [row.deviceId, row]));
  const remaining = devices.filter((device) => {
    const row = byDevice.get(device.id);
    return row !== undefined;
  });
  const allSent = remaining.every((device) => byDevice.get(device.id)?.status === 'sent');
  const allDone = remaining.every((device) => {
    const row = byDevice.get(device.id);
    return row?.status === 'sent' || (row?.status === 'failed' && row.permanent);
  });
  return { skipped: false, allSent, allDone, retryable, lastError };
}
