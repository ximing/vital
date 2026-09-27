import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { NotificationOutboxRow } from '../db/schema.js';

const TOKEN_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const PACKAGE_NAME = 'plus.aimo.vital';

export type HuaweiSendResult =
  | { ok: true }
  | { ok: false; permanent: boolean; invalidToken: boolean; error: string };

export interface HuaweiTransport {
  postForm(url: string, body: string): Promise<{ httpStatus: number; json: unknown }>;
  postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ httpStatus: number; json: unknown }>;
}

type PushTarget =
  | { kind: 'task'; id: string }
  | { kind: 'day'; id: string }
  | { kind: 'today' };

let transport: HuaweiTransport | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

export function setHuaweiTransport(next: HuaweiTransport | null): void {
  transport = next;
  cachedToken = null;
}

export function huaweiPushConfigured(): boolean {
  return Boolean(config.HUAWEI_PUSH_CLIENT_ID && config.HUAWEI_PUSH_CLIENT_SECRET);
}

export function pushTargetOf(job: {
  eventType: string;
  entityId: string;
}): PushTarget {
  if (job.eventType === 'task.remind' || job.eventType === 'task.due') {
    return { kind: 'task', id: job.entityId };
  }
  if (job.eventType === 'day.remind') return { kind: 'day', id: job.entityId };
  return { kind: 'today' };
}

/** Intent URI Huawei shows in the tray. Tapping it opens vital://… in the app. */
export function huaweiClickIntent(target: PushTarget): string {
  const data =
    target.kind === 'task' ? `task/${target.id}` : target.kind === 'day' ? `day/${target.id}` : 'today';
  return `intent://${data}#Intent;scheme=vital;package=${PACKAGE_NAME};launchFlags=0x14000000;end`;
}

export function huaweiMessageBody(
  title: string,
  body: string,
  target: PushTarget,
  token: string,
): Record<string, unknown> {
  return {
    validate_only: false,
    message: {
      token: [token],
      android: {
        category: 'WORK',
        notification: {
          title,
          body,
          foreground_show: true,
          click_action: {
            type: 1,
            intent: huaweiClickIntent(target),
          },
        },
      },
    },
  };
}

function codeOf(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null || !('code' in json)) return undefined;
  const value = json.code;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function messageOf(json: unknown): string {
  if (typeof json !== 'object' || json === null || !('msg' in json)) return '华为推送失败';
  return typeof json.msg === 'string' ? json.msg : '华为推送失败';
}

async function defaultTransport(): Promise<HuaweiTransport> {
  const { request } = await import('undici');
  return {
    async postForm(url, body) {
      const res = await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.body.text();
      return { httpStatus: res.statusCode, json: JSON.parse(text) as unknown };
    },
    async postJson(url, headers, body) {
      const res = await request(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.body.text();
      return { httpStatus: res.statusCode, json: JSON.parse(text) as unknown };
    },
  };
}

async function accessToken(client: HuaweiTransport): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;
  const clientId = config.HUAWEI_PUSH_CLIENT_ID ?? 'test';
  const clientSecret = config.HUAWEI_PUSH_CLIENT_SECRET ?? 'test';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();
  const res = await client.postForm(TOKEN_URL, body);
  const json = res.json;
  const token =
    typeof json === 'object' && json !== null && 'access_token' in json && typeof json.access_token === 'string'
      ? json.access_token
      : '';
  const expiresIn =
    typeof json === 'object' && json !== null && 'expires_in' in json && typeof json.expires_in === 'number'
      ? json.expires_in
      : 0;
  if (token === '' || res.httpStatus !== 200) throw new Error('华为推送鉴权失败');
  cachedToken = { value: token, expiresAt: now + Math.max(60, expiresIn - 60) * 1000 };
  return token;
}

export async function sendHuaweiPush(input: {
  token: string;
  title: string;
  body: string;
  target: PushTarget;
}): Promise<HuaweiSendResult> {
  if (!huaweiPushConfigured() && transport === null) {
    return { ok: false, permanent: false, invalidToken: false, error: '华为推送未配置' };
  }
  const client = transport ?? (await defaultTransport());
  try {
    const bearer = await accessToken(client);
    const appId = config.HUAWEI_PUSH_CLIENT_ID ?? 'test';
    const res = await client.postJson(
      `https://push-api.cloud.huawei.com/v1/${appId}/messages:send`,
      { Authorization: `Bearer ${bearer}` },
      huaweiMessageBody(input.title, input.body, input.target, input.token),
    );
    const code = codeOf(res.json);
    if (code === '80000000') return { ok: true };
    const invalidToken = code === '80300007';
    const permanent = invalidToken || code === '80100003';
    logger.warn('huawei.push.fail', { code, permanent });
    return {
      ok: false,
      permanent,
      invalidToken,
      error: messageOf(res.json).slice(0, 500),
    };
  } catch (err) {
    logger.warn('huawei.push.error', { err: String(err) });
    return { ok: false, permanent: false, invalidToken: false, error: '华为推送网络错误' };
  }
}

export function huaweiTargetFor(job: Pick<NotificationOutboxRow, 'eventType' | 'entityId'>): PushTarget {
  return pushTargetOf(job);
}
