import { Agent, request } from 'undici';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export type MeowSendInput = {
  nickname: string;
  title: string;
  msg: string;
  url?: string;
  imgUrl?: string;
};

export type MeowSendResult =
  | { ok: true }
  | { ok: false; permanent: boolean; error: string; status?: number };

export interface MeowTransport {
  postJson(
    url: string,
    body: Record<string, unknown>,
  ): Promise<{ httpStatus: number; json: unknown }>;
}

/** Dedicated agent so HTTP_PROXY / Clash cannot hijack MeoW (shared-IP abuse). */
const directAgent = new Agent({ connect: { timeout: 10_000 } });

const defaultTransport: MeowTransport = {
  async postJson(url, body) {
    const res = await request(url, {
      method: 'POST',
      dispatcher: directAgent,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.body.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { status: 500, msg: text.slice(0, 200) };
    }
    return { httpStatus: res.statusCode, json };
  },
};

let transport: MeowTransport = defaultTransport;

/** Test seam. Do not call from product code. */
export function setMeowTransport(next: MeowTransport | null): void {
  transport = next ?? defaultTransport;
}

function jsonStatus(json: unknown): number | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  if (!('status' in json)) return undefined;
  const value = json.status;
  return typeof value === 'number' ? value : undefined;
}

function jsonMessage(json: unknown): string {
  if (typeof json !== 'object' || json === null) return 'MeoW 响应无法解析';
  if ('message' in json && typeof json.message === 'string') return json.message;
  if ('msg' in json && typeof json.msg === 'string') return json.msg;
  return 'MeoW 发送失败';
}

export function meowPushUrl(nickname: string, baseUrl = config.MEOW_BASE_URL): string {
  const root = baseUrl.replace(/\/$/, '');
  return `${root}/${encodeURIComponent(nickname)}?msgType=text`;
}

export async function sendMeow(input: MeowSendInput): Promise<MeowSendResult> {
  const url = meowPushUrl(input.nickname);
  const body: Record<string, unknown> = {
    title: input.title,
    msg: input.msg,
  };
  if (input.url) body.url = input.url;
  if (input.imgUrl) body.imgUrl = input.imgUrl;
  try {
    const res = await transport.postJson(url, body);
    const status = jsonStatus(res.json) ?? (res.httpStatus === 200 ? 500 : res.httpStatus);
    if (status === 200) return { ok: true };
    const permanent = status === 400 || status === 403 || status === 404;
    logger.warn('meow.send.fail', { status, permanent });
    return { ok: false, permanent, error: jsonMessage(res.json).slice(0, 500), status };
  } catch (err) {
    logger.warn('meow.send.error', { err: String(err) });
    return { ok: false, permanent: false, error: 'MeoW 网络错误' };
  }
}
